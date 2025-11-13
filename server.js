import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;
const PODNAPISI_USER = "patagero";
const PODNAPISI_PASS = "Formio1978";
let cachedCookies = null;

// 🎬 IMDb → naslov
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

// 🔐 Prijava (samo enkrat)
async function ensureLogin() {
  if (cachedCookies) return cachedCookies;

  console.log("🔐 Pridobivam nove piškotke ...");
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  await page.goto("https://www.podnapisi.net/sl/login", { waitUntil: "domcontentloaded" });

  // Dinamični login
  await page.waitForSelector("input[type='text'], input[name*='user']", { timeout: 10000 });
  const textInputs = await page.$$("input[type='text'], input[name*='user']");
  await textInputs[0].type(PODNAPISI_USER, { delay: 30 });
  await page.type("input[type='password']", PODNAPISI_PASS, { delay: 30 });
  await Promise.all([
    page.click("button[type='submit'], input[type='submit']"),
    page.waitForNavigation({ waitUntil: "networkidle0", timeout: 20000 }).catch(() => {}),
  ]);

  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes("Odjava") || bodyText.includes("Moj profil"))
    console.log("✅ Prijava uspešna.");
  else console.log("⚠️ Prijava morda nepopolna.");

  cachedCookies = await page.cookies();
  await browser.close();
  return cachedCookies;
}

// 🔍 Iskanje podnapisov po imenu (klasično)
async function scrapeSubtitlesByTitle(title) {
  console.log(`🌍 Iščem slovenske podnapise za: ${title}`);
  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  const cookies = await ensureLogin();
  await page.setCookie(...cookies);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 40000 });

  let results = [];
  try {
    await page.waitForSelector(".subtitle-entry, table.table tbody tr", { timeout: 8000 });
    results = await page.$$eval(".subtitle-entry, table.table tbody tr", (rows) =>
      rows.map((r) => {
        const link = r.querySelector("a[href*='/download']")?.href || r.querySelector("a[href*='/subtitles/']")?.href;
        const name = r.querySelector(".release, a")?.textContent?.trim() || "Neznan";
        const lang = r.innerText.toLowerCase().includes("slovenski") ? "sl" : "";
        return link && lang ? { name, link, lang } : null;
      }).filter(Boolean)
    );
  } catch {
    console.log("⚠️ Ni bilo mogoče prebrati tabelo rezultatov.");
  }

  await browser.close();
  console.log(`✅ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "13.2.0",
    name: "Formio Podnapisi.NET 🇸🇮 Classic",
    description: "Iskanje slovenskih podnapisov po imenu (brez API, s prijavo)",
    types: ["movie", "series"],
    resources: [{ name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] }],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// 🎬 Endpoint
app.get("/subtitles/:type/:imdbId/*", async (req, res) => {
  console.log("==================================================");
  const imdbId = req.params.imdbId;
  const fullUrl = req.url;

  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
  console.log(`🧩 Celoten URL: ${fullUrl}`);

  const filenameMatch = decodeURIComponent(fullUrl).match(/filename=([^&]+)/);
  let searchTerm = filenameMatch ? decodeURIComponent(filenameMatch[1]) : await getTitleFromIMDb(imdbId);

  searchTerm = searchTerm
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[\._\-]/g, " ")
    .replace(/\b(2160p|1080p|720p|hdr|x265|bluray|rip|dts|aac|uhd|remux|brrip|hevc)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  console.log(`🎯 Iščem po imenu: ${searchTerm}`);

  const results = await scrapeSubtitlesByTitle(searchTerm);

  if (!results.length) {
    console.log(`❌ Ni najdenih podnapisov za: ${searchTerm}`);
    return res.json({ subtitles: [] });
  }

  const subtitles = results.map((r, i) => ({
    id: `formio-${i + 1}`,
    lang: "sl",
    url: r.link,
    name: `${r.name} 🇸🇮`,
  }));

  console.log(`📦 Pošiljam ${subtitles.length} podnapisov`);
  res.json({ subtitles });
});

// 🩺 Health check
app.get("/health", (_, res) => res.send("✅ OK"));
app.get("/", (_, res) => res.redirect("/manifest.json"));

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 Classic v13.2.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
