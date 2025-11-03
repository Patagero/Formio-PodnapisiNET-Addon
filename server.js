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
  version: "6.5.0",
  name: "Formio Podnapisi.NET 🇸🇮+🇬🇧",
  description: "Hiter iskalnik slovenskih in angleških podnapisov s prijavo in cache sistemom",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const langMap = { sl: "🇸🇮", en: "🇬🇧" };

// 🧠 CACHE funkcije
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// 🧹 Avtomatsko čiščenje tmp mape
function cleanTmpDir() {
  const now = Date.now();
  fs.readdirSync(TMP_DIR).forEach(file => {
    const fullPath = path.join(TMP_DIR, file);
    const stats = fs.statSync(fullPath);
    if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    }
  });
}

// 🔧 Puppeteer brskalnik
let globalBrowser = null;
let globalCookiesLoaded = false;

async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  const executablePath = await chromium.executablePath();
  globalBrowser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
    headless: chromium.headless
  });
  return globalBrowser;
}

// 🔐 Prijava z uporabo piškotkov
async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");

  if (fs.existsSync(cookiesPath) && globalCookiesLoaded) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Piškotki uporabljeni – prijava preskočena.");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes("Odjava") || bodyText.includes("Moj profil")) {
    console.log("✅ Uporabnik že prijavljen.");
    globalCookiesLoaded = true;
    return;
  }

  await page.waitForSelector("input[name='username']", { timeout: 20000 });
  await page.type("input[name='username']", USERNAME, { delay: 20 });
  await page.type("input[name='password']", PASSWORD, { delay: 20 });

  const loginBtn = (await page.$("form[action*='login'] button")) ||
                   (await page.$("form[action*='login'] input[type='submit']"));
  await loginBtn.click();

  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 20000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch {
    console.log("⚠️ Prijava morda počasna, nadaljujem z obstoječo sejo.");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  globalCookiesLoaded = true;
  console.log("💾 Piškotki shranjeni.");
}

// 🎬 IMDb → Naslov
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title}`);
      return data.Title.trim();
    }
  } catch {
    console.log("⚠️ IMDb API napaka");
  }
  return imdbId;
}

// 🔍 Iskanje podnapisov po jeziku
async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  const html = await page.content();
  await page.close();

  const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
  const results = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    results.push({
      link: "https://www.podnapisi.net" + match[1],
      title: match[2].trim(),
      lang: langCode
    });
  }

  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  return results;
}

// 📜 Glavni API endpoint
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Zahteva za IMDb:", imdbId);

  cleanTmpDir(); // 🧹 čistimo stare datoteke

  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  // 🔄 Iskanje obeh jezikov vzporedno
  const [slResults, enResults] = await Promise.all([
    fetchSubtitlesForLang(browser, title, "sl"),
    fetchSubtitlesForLang(browser, title, "en")
  ]);

  const allResults = [...slResults, ...enResults];
  if (!allResults.length) {
    console.log("❌ Ni bilo najdenih podnapisov.");
    return res.json({ subtitles: [] });
  }

  console.log(`📦 Skupno: 🇸🇮 ${slResults.length} | 🇬🇧 ${enResults.length}`);

  // ⚡ Prenos in ekstrakcija v vzporedju
  const subtitles = await Promise.all(allResults.map(async (r, idx) => {
    const zipPath = path.join(TMP_DIR, `${imdbId}_${idx + 1}.zip`);
    const extractDir = path.join(TMP_DIR, `${imdbId}_${idx + 1}`);
    const flag = langMap[r.lang] || "🌐";

    try {
      const resp = await fetch(r.link);
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length < 2000) return null; // preskoči prazne ZIP datoteke

      fs.writeFileSync(zipPath, buf);
      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      const srt = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
      if (srt) {
        console.log(`📜 ${flag} ${srt}`);
        return {
          id: `formio-podnapisi-${idx + 1}`,
          url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${idx + 1}/${encodeURIComponent(srt)}`,
          lang: r.lang,
          name: `${flag} ${r.title} (${r.lang.toUpperCase()})`
        };
      }
    } catch (e) {
      console.log(`⚠️ Napaka pri #${idx + 1}: ${e.message}`);
    }
    return null;
  }));

  const filtered = subtitles.filter(Boolean);
  cache[imdbId] = { timestamp: Date.now(), data: filtered };
  saveCache(cache);

  console.log(`✅ Končano – ${filtered.length} podnapisov shranjenih.`);
  res.json({ subtitles: filtered });
});

// 📂 Strežnik za datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Zagon
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮+🇬🇧 – hitra verzija (cache + paralelni prenos + čiščenje)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
