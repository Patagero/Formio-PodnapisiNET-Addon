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
  version: "7.0.0",
  name: "Formio Podnapisi.NET 🇸🇮+🇬🇧",
  description: "Hitro iskanje slovenskih in angleških podnapisov (API prestrezanje, cache, prijava, retry)",
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

// 📦 CACHE
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// 🧹 Avtomatsko čiščenje tmp map
function cleanTmpDir() {
  const now = Date.now();
  fs.readdirSync(TMP_DIR).forEach(file => {
    const full = path.join(TMP_DIR, file);
    const stats = fs.statSync(full);
    if (now - stats.mtimeMs > 24 * 60 * 60 * 1000) {
      fs.rmSync(full, { recursive: true, force: true });
    }
  });
}

// 🧩 Chromium z retry
let globalBrowser = null;
let globalCookiesLoaded = false;

async function getBrowser(retries = 3, delay = 5000) {
  if (globalBrowser) return globalBrowser;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      let executablePath = await chromium.executablePath();
      if (!executablePath)
        executablePath = puppeteer.executablePath?.() || "/usr/bin/chromium-browser";

      globalBrowser = await puppeteer.launch({
        args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
        executablePath,
        headless: chromium.headless !== false
      });
      console.log(`✅ Chromium zagnan (poskus: ${attempt})`);
      return globalBrowser;
    } catch (err) {
      console.log(`⚠️ Napaka pri zagonu Chromium (poskus ${attempt}):`, err.message);
      if (attempt < retries) await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error("❌ Chromium se ni mogel zagnati.");
}

// 🔐 Prijava
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

  await page.waitForSelector("input[name='username']", { timeout: 25000 });
  await page.type("input[name='username']", USERNAME, { delay: 25 });
  await page.type("input[name='password']", PASSWORD, { delay: 25 });

  const loginBtn = (await page.$("form[action*='login'] button")) ||
                   (await page.$("form[action*='login'] input[type='submit']"));
  if (loginBtn) await loginBtn.click();

  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 25000 }
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

// 🔍 Novi način: prestrezanje AJAX API odgovorov
async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${searchUrl}`);

  let ajaxResponse = null;
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/api/subtitles/search") && response.status() === 200) {
      try {
        ajaxResponse = await response.json();
      } catch {}
    }
  });

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  // čakaj do 10s, da pride AJAX odgovor
  for (let i = 0; i < 20 && !ajaxResponse; i++) {
    await new Promise(r => setTimeout(r, 500));
  }

  if (!ajaxResponse || !ajaxResponse.subtitles?.length) {
    console.log(`⚠️ Ni rezultatov za ${langCode}`);
    await page.close();
    return [];
  }

  const results = ajaxResponse.subtitles.map(sub => ({
    link: "https://www.podnapisi.net" + sub.url,
    title: sub.release || sub.title || "Neznan",
    fps: sub.fps || "",
    cds: sub.cd || "",
    rating: sub.rating || 0,
    lang: langCode
  }));

  await page.close();
  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  return results;
}

// 📜 Glavni endpoint
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Zahteva za IMDb:", imdbId);

  cleanTmpDir();
  const cache = loadCache();

  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const [slResults, enResults] = await Promise.all([
    fetchSubtitlesForLang(browser, title, "sl"),
    fetchSubtitlesForLang(browser, title, "en")
  ]);

  const allResults = [...slResults, ...enResults];
  if (!allResults.length) {
    console.log("❌ Ni bilo najdenih podnapisov.");
    return res.json({ subtitles: [] });
  }

  // sortiraj po jeziku in oceni
  allResults.sort((a, b) => b.rating - a.rating);

  console.log(`📦 Skupno: 🇸🇮 ${slResults.length} | 🇬🇧 ${enResults.length}`);

  const subtitles = allResults.map((r, idx) => {
    const flag = langMap[r.lang] || "🌐";
    return {
      id: `formio-podnapisi-${idx + 1}`,
      url: r.link,
      lang: r.lang,
      name: `${flag} ${r.title} (${r.lang.toUpperCase()}) [${r.fps || "fps?"}, CD:${r.cds || "?"}]`
    };
  });

  cache[imdbId] = { timestamp: Date.now(), data: subtitles };
  saveCache(cache);

  console.log(`✅ Končano – ${subtitles.length} podnapisov.`);
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

// 💥 Globalno logiranje napak
process.on("unhandledRejection", (r) => console.error("🚨 Unhandled Rejection:", r));
process.on("uncaughtException", (e) => console.error("💥 Uncaught Exception:", e));

// 🚀 Zagon
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮+🇬🇧 – ultra hitra API verzija (AJAX intercept + cache + login)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
