// ==================================================
//  Formio Podnapisi.NET 🇸🇮  —  Render-safe verzija V8.0.5
// ==================================================
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import os from "os";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const TMP_DIR = path.join(os.tmpdir(), "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// === DEMO SCRAPER ===
async function scrapeSubtitles(imdbId) {
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
  const searchUrl = `https://www.podnapisi.net/subtitles/search/?keywords=${imdbId}`;
  const executablePath = await chromium.executablePath;

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  const results = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".subtitle-entry"));
    return items.map((el) => ({
      title: el.querySelector(".release")?.textContent?.trim(),
      lang: el.querySelector(".language")?.textContent?.trim(),
    }));
  });

  await browser.close();
  return results;
}

// === API ZA PODNAPISE ===
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  try {
    const subs = await scrapeSubtitles(imdbId);
    res.json({ subtitles: subs });
  } catch (err) {
    console.error("❌ Napaka pri iskanju:", err);
    res.status(500).json({ error: "Scrape failed" });
  }
});

// === DATOTEKE (TMP predpomnilnik) ===
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) {
    res.setHeader("Content-Type", "text/srt; charset=utf-8");
    res.sendFile(filePath);
  } else {
    res.status(404).send("Subtitle not found");
  }
});

// === ROOT STRAN ===
app.get("/", (req, res) => {
  res.send(`
    <h1>✅ Formio Podnapisi.NET 🇸🇮 Addon je aktiven</h1>
    <p>Manifest: <a href="/manifest.json">/manifest.json</a></p>
    <p>Testni primeri:</p>
    <ul>
      <li><a href="/subtitles/movie/tt0120338.json">Titanic (1997)</a></li>
      <li><a href="/subtitles/movie/tt1375666.json">Inception (2010)</a></li>
      <li><a href="/ping">Ping test</a></li>
    </ul>
  `);
});

// === MANIFEST ZA STREMIO ===
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.formio.podnapisi",
    version: "8.0.5",
    name: "Formio Podnapisi.NET 🇸🇮 (Regex Napad)",
    description:
      "Uporablja iskanje po IMDb ID-ju, pri neuspehu preklopi na robusten Regex Fallback.",
    logo: "https://www.podnapisi.net/favicon.ico",
    types: ["movie", "series"],
    resources: ["subtitles"],
    idPrefixes: ["tt"],
  });
});

// === HEALTH CHECK ===
app.get("/ping", (req, res) => {
  res.json({ pong: true, time: new Date().toISOString() });
});

// === ZAGON STREŽNIKA ===
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  // Če Render ne poda env URL, uporabimo znanega
  const host =
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RENDER_URL ||
    "formio-podnapisinet-addon-1.onrender.com";
  const PUBLIC_URL = `https://${host}`;

  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.0.5, Render-safe Chromium)");
  console.log("💥 Regex prioriteta pri iskanju po naslovu aktivna");
  console.log(`🌐 Manifest: ${PUBLIC_URL}/manifest.json`);
  console.log("==================================================");
});
