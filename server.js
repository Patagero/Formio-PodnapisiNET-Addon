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
  version: "6.4.0",
  name: "Formio Podnapisi.NET 🇸🇮+🇬🇧",
  description: "Prikaz napredka iskanja slovenskih in angleških podnapisov",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

const langMap = { sl: "🇸🇮", en: "🇬🇧" };
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
    console.log("🍪 Uporabljeni obstoječi piškotki (login preskočen).");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes("Odjava") || bodyText.includes("Moj profil")) {
    console.log("✅ Uporabnik že prijavljen.");
    globalCookiesLoaded = true;
    return;
  }

  await page.waitForSelector("input[name='username']", { timeout: 30000 });
  await page.type("input[name='username']", USERNAME, { delay: 25 });
  await page.type("input[name='password']", PASSWORD, { delay: 25 });
  const loginBtn = (await page.$("form[action*='login'] button")) ||
                   (await page.$("form[action*='login'] input[type='submit']"));
  await loginBtn.click();

  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 30000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch {
    console.log("⚠️ Prijava ni potrjena (morda počasno nalaganje).");
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

async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  let results = [];
  try {
    results = await page.$$eval("table.table tbody tr", (rows) =>
      rows.map((row) => {
        const link = row.querySelector("a[href*='/download']")?.href;
        const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
        return link ? { link, title } : null;
      }).filter(Boolean)
    );
  } catch (err) {
    console.log(`⚠️ Napaka pri branju DOM (${langCode}):`, err.message);
  }

  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  await page.close();
  return results.map((r, i) => ({ ...r, lang: langCode, index: i + 1 }));
}

// 📜 Glavni endpoint
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  // ⏱️ Stremio takoj dobi “isSearching: true”
  res.writeHead(200, { "Content-Type": "application/json" });
  res.write(JSON.stringify({ isSearching: true, status: "🔍 Iščem podnapise ..." }));

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const [slResults, enResults] = await Promise.all([
    fetchSubtitlesForLang(browser, title, "sl"),
    fetchSubtitlesForLang(browser, title, "en")
  ]);

  const results = [...slResults, ...enResults];
  console.log(`📦 Skupno najdenih: 🇸🇮 ${slResults.length} | 🇬🇧 ${enResults.length}`);

  if (!results.length) {
    res.end(JSON.stringify({ subtitles: [], status: "❌ Ni bilo najdenih podnapisov." }));
    return;
  }

  const subtitles = [];
  let idx = 1;

  for (const r of results) {
    const flag = langMap[r.lang] || "🌐";
    subtitles.push({
      id: `formio-podnapisi-${idx}`,
      url: r.link,
      lang: r.lang,
      name: `${flag} ${r.title} (${r.lang.toUpperCase()})`
    });
    idx++;
  }

  res.end(JSON.stringify({ subtitles, status: `✅ Najdenih 🇸🇮 ${slResults.length} in 🇬🇧 ${enResults.length}` }));
});

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮+🇬🇧 aktiven (vključen status JSON za Stremio)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
