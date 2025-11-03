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

// 📦 Manifest
const manifest = {
  id: "org.formio.podnapisi",
  version: "6.1.0",
  name: "Formio Podnapisi.NET 🇸🇮+🇬🇧",
  description: "Samodejno išče slovenske in angleške podnapise (z letnico in prijavo)",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

const langMap = { sl: "🇸🇮", en: "🇬🇧" };

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// 🔒 Prijava z uporabo piškotkov
async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");
  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Shranjeni piškotki — preskočen login.");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  await page.waitForSelector("input[name='username']", { timeout: 15000 });
  await page.type("input[name='username']", USERNAME, { delay: 25 });
  await page.type("input[name='password']", PASSWORD, { delay: 25 });

  const loginBtn = (await page.$("form[action*='login'] button")) ||
                   (await page.$("form[action*='login'] input[type='submit']"));

  if (!loginBtn) throw new Error("⚠️ Gumb za prijavo ni bil najden.");
  await loginBtn.click();

  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 20000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch {
    console.log("⚠️ Prijava ni potrjena (morda počasno nalaganje).");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  console.log("💾 Piškotki shranjeni.");
}

// 🎬 IMDb → naslov + letnica
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return `${data.Title} ${data.Year || ""}`.trim();
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// 🧩 Chromium
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
    headless: chromium.headless
  });
}

// 🔍 Iskanje podnapisov z izboljšanim čakanjem in regex fallback
async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

  try {
    await page.waitForSelector("table.table tbody tr", { timeout: 10000 });
  } catch {
    console.log(`⌛ Rezultati se niso pojavili pravočasno (${langCode}) – poskušam regex fallback.`);
  }

  const html = await page.content();
  let results = [];

  try {
    results = await page.$$eval("table.table tbody tr", (rows) =>
      rows.map((row) => {
        const link = row.querySelector("a[href*='/download']")?.href;
        const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
        return link ? { link, title } : null;
      }).filter(Boolean)
    );
  } catch {}

  if (!results.length) {
    const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const link = "https://www.podnapisi.net" + match[1];
      const title = match[2].trim();
      results.push({ link, title });
    }
  }

  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  return results.map((r, i) => ({ ...r, lang: langCode, index: i + 1 }));
}

// 📜 Glavna pot
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const loginPage = await browser.newPage();
  await ensureLoggedIn(loginPage);

  const [slResults, enResults] = await Promise.all([
    fetchSubtitlesForLang(browser, title, "sl"),
    fetchSubtitlesForLang(browser, title, "en")
  ]);

  const results = [...slResults, ...enResults];
  if (!results.length) {
    await browser.close();
    return res.json({ subtitles: [] });
  }

  const subtitles = [];
  let idx = 1;
  for (const r of results) {
    const downloadLink = r.link;
    const zipPath = path.join(TMP_DIR, `${imdbId}_${idx}.zip`);
    const extractDir = path.join(TMP_DIR, `${imdbId}_${idx}`);
    const flag = langMap[r.lang] || "🌐";

    try {
      const zipRes = await fetch(downloadLink);
      const buf = Buffer.from(await zipRes.arrayBuffer());
      fs.writeFileSync(zipPath, buf);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
      if (srtFile) {
        subtitles.push({
          id: `formio-podnapisi-${idx}`,
          url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${idx}/${encodeURIComponent(srtFile)}`,
          lang: r.lang,
          name: `${flag} ${r.title} (${r.lang.toUpperCase()})`
        });
        console.log(`📜 [${r.lang}] ${srtFile}`);
        idx++;
      }
    } catch (err) {
      console.log(`⚠️ Napaka pri prenosu #${idx}:`, err.message);
    }
  }

  await browser.close();
  cache[imdbId] = { timestamp: Date.now(), data: subtitles };
  saveCache(cache);
  res.json({ subtitles });
});

// 📂 Strežnik za datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Zagon strežnika
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮+🇬🇧 aktiven (regex fallback, hitrejše iskanje, cache)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
