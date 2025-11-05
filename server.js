// ==================================================
//  Formio Podnapisi.NET 🇸🇮 — verzija V8.4.0
//  Realni Puppeteer scraping z login sejo (Render-safe)
// ==================================================
import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import os from "os";
import path from "path";
import fs from "fs";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Lokacija za začasne datoteke
const TMP_DIR = path.join(os.tmpdir(), "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// --------------------------------------------------
// 🔐 Prijava v podnapisi.net
// --------------------------------------------------
async function loginAndGetBrowser() {
  console.log("🔐 Prijava v podnapisi.net ...");

  const executablePath = await chromium.executablePath();

  const browser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.goto("https://www.podnapisi.net/sl/login", {
    waitUntil: "networkidle2",
  });

  await page.type('input[name="username"]', "patagero");
  await page.type('input[name="password"]', "Formio1978");
  await Promise.all([
    page.click('button[type="submit"], input[type="submit"]'),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }),
  ]);

  console.log("✅ Prijava uspešna");
  return { browser, page };
}

// --------------------------------------------------
// 🔍 Iskanje slovenskih podnapisov
// --------------------------------------------------
async function scrapeSubtitles(imdbId) {
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

  const { browser, page } = await loginAndGetBrowser();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${imdbId}`;
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  // počakamo, da se naloži tabela s podnapisi
  try {
    await page.waitForSelector("table.table tbody tr", { timeout: 10000 });
  } catch {
    console.warn("⚠️ Ni bilo mogoče najti tabele s podnapisi.");
    await browser.close();
    return [];
  }

  // izvlečemo podatke o podnapisih
  const subtitles = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table.table tbody tr"));
    return rows
      .map((row) => {
        const language = row.querySelector(".language")?.textContent?.trim();
        const title = row.querySelector(".release")?.textContent?.trim();
        const link = row.querySelector('a[href*="/subtitles/"]')?.getAttribute("href");
        if (language && language.toLowerCase().includes("slov")) {
          return {
            title,
            lang: language,
            download: link ? `https://www.podnapisi.net${link}` : null,
          };
        }
        return null;
      })
      .filter(Boolean);
  });

  console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);
  await browser.close();
  return subtitles;
}

// --------------------------------------------------
// 🌐 API endpoint
// --------------------------------------------------
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  try {
    const { imdbId } = req.params;
    const subtitles = await scrapeSubtitles(imdbId);
    res.json({ subtitles });
  } catch (err) {
    console.error("❌ Napaka:", err.message);
    res.status(500).json({ error: "Scrape failed" });
  }
});

// --------------------------------------------------
// 🧭 Info + manifest
// --------------------------------------------------
app.get("/", (req, res) => {
  res.send(`
    <h1>✅ Formio Podnapisi.NET 🇸🇮 (v8.4.0)</h1>
    <p>Avtomatsko iskanje slovenskih podnapisov po IMDb ID.</p>
    <p>Manifest: <a href="/manifest.json">/manifest.json</a></p>
    <ul>
      <li><a href="/subtitles/movie/tt0120338.json">Titanic (1997)</a></li>
      <li><a href="/subtitles/movie/tt1375666.json">Inception (2010)</a></li>
    </ul>
  `);
});

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.formio.podnapisi",
    version: "8.4.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description:
      "Stabilno iskanje slovenskih podnapisov (Puppeteer + login sejni dostop)",
    logo: "https://www.podnapisi.net/favicon.ico",
    types: ["movie", "series"],
    resources: ["subtitles"],
    idPrefixes: ["tt"],
  });
});

// --------------------------------------------------
// 🚀 Zagon strežnika
// --------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.4.0)");
  console.log("💬 Prijava + Puppeteer scraping v uporabi");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
