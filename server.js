import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "9.1.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description:
    "Išče slovenske podnapise s takojšnjim odgovorom in fallback regex sistemom (hitro delovanje brez prijave)",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"],
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const langMap = { sl: "🇸🇮" };

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE))
  fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

let globalBrowser = null;

async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  const executablePath =
    (await chromium.executablePath()) ||
    puppeteer.executablePath?.() ||
    "/usr/bin/chromium-browser";

  globalBrowser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
    headless: chromium.headless !== false,
  });
  console.log("✅ Chromium zagnan");
  return globalBrowser;
}

// 🎬 IMDb → naslov
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`
    );
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title}`);
      return data.Title.trim();
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// 🔍 Pridobi slovenske podnapise (API + regex fallback)
async function fetchSubtitles(browser, title) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
    title
  )}&language=sl`;
  console.log(`🌍 Iščem 🇸🇮: ${searchUrl}`);

  let ajax = null;
  page.on("response", async (r) => {
    if (r.url().includes("/api/subtitles/search") && r.status() === 200) {
      try {
        ajax = await r.json();
      } catch {}
    }
  });

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  for (let i = 0; i < 30 && !ajax; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ajax?.subtitles?.length) {
    const html = await page.content();
    const results = [];
    const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const link = "https://www.podnapisi.net" + match[1];
      const subTitle = match[2].trim();
      if (subTitle) results.push({ link, title: subTitle });
    }
    await page.close();

    if (!results.length) {
      console.log("⚠️ Ni slovenskih rezultatov (niti po regexu)");
      return [];
    }

    console.log(`✅ Najdenih ${results.length} 🇸🇮 (regex fallback)`);
    return results.map((r, i) => ({
      link: r.link,
      title: r.title,
      index: i + 1,
    }));
  }

  await page.close();
  console.log(`✅ Najdenih ${ajax.subtitles.length} 🇸🇮 (API način)`);
  return ajax.subtitles.map((s, i) => ({
    link: "https://www.podnapisi.net" + s.url,
    title: s.release || s.title || "Neznan",
    index: i + 1,
  }));
}

// 🚀 Glavna pot
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Zahteva za IMDb:", imdbId);

  const cache = loadCache();
  const cached = cache[imdbId];

  // ⚡ Takojšnji dummy odgovor za Stremio
  res.json({
    subtitles: cached?.data?.length
      ? cached.data
      : [
          {
            id: "formio-loading",
            url: "https://formio-podnapisinet-addon-1.onrender.com/loading.srt",
            lang: "sl",
            name: "⏳ Nalagam slovenske podnapise …",
          },
        ],
  });

  // 🌀 Iskanje v ozadju
  (async () => {
    try {
      const title = await getTitleFromIMDb(imdbId);
      const browser = await getBrowser();
      const slResults = await fetchSubtitles(browser, title);

      if (!slResults.length) {
        console.log(`❌ Ni slovenskih podnapisov za ${title}`);
        return;
      }

      const subtitles = slResults.map((r, i) => ({
        id: `formio-${i + 1}`,
        url: r.link,
        lang: "sl",
        name: `${langMap.sl} ${r.title} (SLO)`,
      }));

      cache[imdbId] = { timestamp: Date.now(), data: subtitles };
      saveCache(cache);
      console.log(`♻️ Osveženi podatki (${subtitles.length}) za ${title}`);
    } catch (e) {
      console.log("⚠️ Napaka pri iskanju:", e.message);
    }
  })();
});

// 🧹 Samodejno čiščenje tmp
setInterval(() => {
  const files = fs.readdirSync(TMP_DIR);
  const now = Date.now();
  for (const f of files) {
    const full = path.join(TMP_DIR, f);
    const stat = fs.statSync(full);
    if (now - stat.mtimeMs > 24 * 60 * 60 * 1000)
      fs.rmSync(full, { recursive: true, force: true });
  }
}, 60 * 60 * 1000);

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 – instant dummy + AJAX/regex fallback + cache");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
