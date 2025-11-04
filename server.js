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
  version: "9.4.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Išče slovenske podnapise z razširjenim filtrom in podrobnim logom",
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

const langMap = { sl: "🇸🇮" };

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

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

async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");
  if (fs.existsSync(cookiesPath) && globalCookiesLoaded) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Uporabljeni obstoječi piškotki.");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  try {
    await page.type("input[name='username']", USERNAME, { delay: 25 });
    await page.type("input[name='password']", PASSWORD, { delay: 25 });
    const loginBtn = await page.$("form[action*='login'] button") || await page.$("form[action*='login'] input[type='submit']");
    await loginBtn.click();
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 30000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch {
    console.log("⚠️ Prijava ni potrjena.");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  globalCookiesLoaded = true;
  console.log("💾 Piškotki shranjeni.");
}

async function getTitleAndYear(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return { title: data.Title.trim(), year: data.Year || "", type: data.Type || "movie" };
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return { title: imdbId, year: "", type: "movie" };
}

async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

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
  } catch {
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

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  const type = req.params.type;
  console.log("==================================================");
  console.log("🎬 Zahteva za IMDb:", imdbId);

  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  const { title, year } = await getTitleAndYear(imdbId);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const slResults = await fetchSubtitlesForLang(browser, title, "sl");

  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const cleanYear = (year || "").replace(/\D+/g, "");

  const filteredResults = slResults.filter(r => {
    const t = r.title.toLowerCase();
    const normalized = t.replace(/[^a-z0-9]+/g, "");

    const titleOk =
      normalized.includes(cleanTitle) ||
      normalized.startsWith(cleanTitle) ||
      normalized.includes(cleanTitle + cleanYear) ||
      (cleanYear && normalized.includes(cleanTitle.slice(0, 4)));

    const isWrong = type === "movie" && /(saints|lois|supergirl|series|season|episode|batman)/.test(t);

    if (!titleOk) console.log(`🚫 Izločen (ni ujemanja): ${r.title}`);
    if (isWrong) console.log(`🚫 Izločen (napačen za film): ${r.title}`);

    return titleOk && !isWrong;
  });

  console.log(`🧩 Po filtriranju ostane ${filteredResults.length} 🇸🇮 relevantnih podnapisov.`);

  if (!filteredResults.length) {
    console.log(`❌ Ni slovenskih podnapisov za ${title}`);
    return res.json({ subtitles: [] });
  }

  const subtitles = [];
  let idx = 1;

  for (const r of filteredResults) {
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
          name: `${flag} ${r.title}`
