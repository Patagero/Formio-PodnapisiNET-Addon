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
  version: "9.0.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Išče samo slovenske podnapise z Render-varnim Chromiumom",
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

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

let globalBrowser = null;
let globalCookiesLoaded = false;

// ✅ Render-safe Chromium
async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  let executablePath;
  try { executablePath = await chromium.executablePath(); }
  catch { executablePath = "/usr/bin/chromium-browser"; }

  globalBrowser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--single-process",
      "--no-zygote",
      "--disable-gpu",
      "--user-data-dir=/tmp/chromium",
      "--homedir=/tmp",
      "--disk-cache-dir=/tmp/cache"
    ],
    executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true
  });
  console.log("✅ Chromium zagnan (Render safe mode)");
  return globalBrowser;
}

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
  await page.waitForTimeout(4000);

  try {
    await page.type("input[name='username']", USERNAME, { delay: 25 });
    await page.type("input[name='password']", PASSWORD, { delay: 25 });
    await page.click("button[type='submit'], input[type='submit']");
    await page.waitForTimeout(3000);
  } catch {
    console.log("⚠️ Prijava ni uspela, nadaljujem brez.");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  globalCookiesLoaded = true;
  console.log("💾 Piškotki shranjeni.");
}

async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return data.Title.trim();
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

async function fetchSubtitles(browser, title) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log(`🌍 Iščem 🇸🇮: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForTimeout(2500);

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
  } catch { }

  console.log(`✅ Najdenih ${results.length} 🇸🇮 podnapisov.`);
  return results;
}

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000)
    return res.json({ subtitles: cache[imdbId].data });

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const results = await fetchSubtitles(browser, title);
  if (!results.length) {
    console.log(`❌ Ni bilo najdenih podnapisov za ${title}`);
    return res.json({ subtitles: [] });
  }

  const subtitles = [];
  let idx = 1;
  for (const r of results) {
    try {
      const zipRes = await fetch(r.link);
      const buf = Buffer.from(await zipRes.arrayBuffer());
      const zipPath = path.join(TMP_DIR, `${imdbId}_${idx}.zip`);
      fs.writeFileSync(zipPath, buf);
      const zip = new AdmZip(zipPath);
      const extractDir = path.join(TMP_DIR, `${imdbId}_${idx}`);
      zip.extractAllTo(extractDir, true);

      const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
      if (srtFile) {
        subtitles.push({
          id: `formio-podnapisi-${idx}`,
          url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${idx}/${encodeURIComponent(srtFile)}`,
          lang: "sl",
          name: `🇸🇮 ${r.title}`
        });
        console.log(`📜 ${srtFile}`);
        idx++;
      }
    } catch (err) {
      console.log("⚠️ Napaka pri prenosu:", err.message);
    }
  }

  cache[imdbId] = { timestamp: Date.now(), data: subtitles };
  saveCache(cache);
  res.json({ subtitles });
});

app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 aktiven (Render-safe Chromium + cache)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
