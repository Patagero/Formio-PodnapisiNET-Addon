import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "6.3.3",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Išče samo slovenske podnapise",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

// Create TMP folder if missing
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

let globalCookies = null;
let globalBrowser = null;

// ============================================================
//  BROWSER LAUNCH (FIXED FOR CHROMIUM v109)
// ============================================================
async function getBrowser() {
  if (globalBrowser) return globalBrowser;

  const executablePath = chromium.path; // ← FIXED

  globalBrowser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
    headless: chromium.headless
  });

  return globalBrowser;
}

// ============================================================
//  LOGIN
// ============================================================
async function ensureLoggedIn(page) {
  if (globalCookies) {
    try {
      await page.setCookie(...globalCookies);
      console.log("🍪 Cookies loaded.");
      return;
    } catch {
      console.log("⚠ Cookie load failed → relogin");
    }
  }

  console.log("🔐 Logging in ...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

  await page.waitForSelector("input[name='username']");
  await page.type("input[name='username']", USERNAME, { delay: 20 });
  await page.type("input[name='password']", PASSWORD, { delay: 20 });

  await Promise.all([
    page.click("button[type='submit'], input[type='submit']"),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
  ]);

  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes("Odjava") || bodyText.includes("Moj profil")) {
    console.log("✅ Login OK");
  } else {
    console.log("⚠ Login maybe failed (no Odjava text)");
  }

  globalCookies = await page.cookies();
}

// ============================================================
//  FIND SLOVENIAN SUBTITLES
// ============================================================
async function searchSlovenianSubs(browser, title) {
  const page = await browser.newPage();
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log("🌍 Searching:", url);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  const results = await page.$$eval("table.table tbody tr", rows =>
    rows.map(row => {
      const link = row.querySelector("a[href*='/download']")?.href || null;
      const name = row.querySelector("a[href*='/download']")?.innerText?.trim() || null;
      if (!link || !name) return null;
      return { link, name };
    }).filter(Boolean)
  );

  console.log(`➡️ Najdenih: ${results.length}`);
  return results;
}

// ============================================================
//  ROUTE: /subtitles/…
// ============================================================
app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;
  console.log("==================================================");
  console.log("🎬 IMDb Request:", imdbId);

  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  // Get title from OMDB (optional)
  let title = imdbId;
  try {
    const data = await (await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`)).json();
    if (data?.Title) title = data.Title;
  } catch {}

  console.log("🎯 Searching for:", title);
  const found = await searchSlovenianSubs(browser, title);

  if (!found.length) {
    console.log("❌ Ni rezultatov.");
    return res.json({ subtitles: [] });
  }

  const subs = found.map((r, i) => ({
    id: `formio-${i + 1}`,
    lang: "sl",
    url: r.link,
    title: `${r.name} 🇸🇮`
  }));

  res.json({ subtitles: subs });
});

// ============================================================
app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 aktiven");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
