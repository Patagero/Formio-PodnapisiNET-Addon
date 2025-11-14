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

// 🔐 Prijava (stealth login, enkrat na zagon)
async function ensureLogin() {
  if (cachedCookies) return cachedCookies;

  console.log("🔐 Pridobivam nove piškotke (stealth mode) ...");
  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );

  await page.goto("https://www.podnapisi.net/sl/login", {
    waitUntil: "networkidle2",
    timeout: 40000,
  });

  await new Promise((r) => setTimeout(r, 3000));

  const userSel = "input[name='username'], input[type='text']";
  const passSel = "input[name='password']";

  if (await page.$(userSel)) await page.type(userSel, PODNAPISI_USER, { delay: 30 });
  if (await page.$(passSel)) await page.type(passSel, PODNAPISI_PASS, { delay: 30 });

  const loginButton = await page.$("button[type='submit'], input[type='submit']");
  if (loginButton) {
    await Promise.all([
      loginButton.click(),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
    ]);
  }

  const body = await page.evaluate(() => document.body.innerText);
  if (body.includes("Odjava") || body.includes("Moj profil"))
    console.log("✅ Prijava uspešna.");
  else console.log("⚠️ Prijava morda nepopolna (captcha ali redirect).");

  cachedCookies = await page.cookies();
  await browser.close();
  console.log("💾 Piškotki shranjeni v RAM.");
  return cachedCookies;
}

// 🔍 Iskanje podnapisov po imenu
async function scrapeSubtitlesByTitle(title) {
  console.log(`🌍 Iščem slovenske podnapise za: ${title}`);
  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );
  await page.setViewport({ width: 1366, height: 768 });
  const cookies = await ensureLogin();
  await page.setCookie(...cookies);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2500));

  let results = [];
  try {
    await page.waitForSelector(".subtitle-entry, table.table tbody tr", { timeout: 8000 });
    results = await page.$$eval(".subtitle-entry, table.table tbody tr", (rows) =>
      rows
        .map((r) => {
          const link =
            r.querySelector("a[href*='/download']")?.href ||
            r.querySelector("a[href*='/subtitles/']")?.href;
          const name = r.querySelector(".release, a")?.textContent?.trim() || "Neznan";
          const lang = r.innerText.toLowerCase().includes("slovenski") ? "sl" : "";
          return link && lang ? { name, link, lang } : null;
        })
        .filter(Boolean)
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
    version: "13.4.0",
    name: "Formio Podnapisi.NET 🇸🇮 Classic Stealth",
    description: "Išče slovenske podnapise samo po imenu filma (brez filename, s prijavo)",
    types: ["movie", "series"],
    resources: [{ name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] }],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// 🎬 Endpoint – iskanje samo po osnovnem naslovu filma
app.get("/subtitles/:type/:imdbId/*", async (req, res) => {
  console.log("==================================================");
  const imdbId = req.params.imdbId;
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

  // 📌 Vedno išči samo po IMDb naslovu (brez filename)
  const searchTerm = await getTitleFromIMDb(imdbId);
  console.log(`🎯 Iščem samo po imenu filma: ${searchTerm}`);

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
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 Stealth v13.4.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
