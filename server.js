// ==================================================
//  Formio Podnapisi.NET 🇸🇮 — Render-safe verzija V8.0.7
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

// === GLAVNA FUNKCIJA ZA PODNAPISE ===
async function scrapeSubtitles(imdbId) {
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
  const searchUrl = `https://www.podnapisi.net/subtitles/search/?keywords=${imdbId}`;
  let executablePath;

  // --- Puppeteer poskus ---
  try {
    executablePath = await chromium.executablePath();
    console.log(`🧠 Chromium zagnan iz: ${executablePath}`);

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
      timeout: 20000,
    });

    const page = await browser.newPage();
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 15000 });

    const results = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".subtitle-entry"));
      return items.map((el) => ({
        title: el.querySelector(".release")?.textContent?.trim(),
        lang: el.querySelector(".language")?.textContent?.trim(),
      }));
    });

    await browser.close();

    if (results.length > 0) {
      console.log(`✅ Puppeteer našel ${results.length} rezultatov`);
      return results;
    } else {
      console.warn("⚠️ Puppeteer ni našel rezultatov, preklapljam na Fetch fallback");
    }
  } catch (err) {
    console.warn("⚠️ Chromium/Puppeteer neuspešen:", err.message);
  }

  // --- Fallback: Fetch način ---
  console.log("🔄 Fetch fallback → podnapisi.net HTML parsing");
  try {
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      },
    });

    const html = await resp.text();
    const regex =
      /<a href="\/subtitles\/[^"]+"[^>]*>\s*<span[^>]*>([^<]+)<\/span>\s*<\/a>[\s\S]*?<span class="language">([^<]+)<\/span>/g;
    const matches = [...html.matchAll(regex)].map((m) => ({
      title: m[1]?.trim(),
      lang: m[2]?.trim(),
    }));

    console.log(`✅ Fallback našel ${matches.length} rezultatov`);
    return matches;
  } catch (err) {
    console.error("❌ Fetch fallback neuspešen:", err);
    return [];
  }
}

// === API POT ZA ISKANJE PODNAPISOV ===
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

// === DATOTEKE IZ TMP ===
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
    version: "8.0.7",
    name: "Formio Podnapisi.NET 🇸🇮 (Regex Napad)",
    description:
      "Uporablja iskanje po IMDb ID-ju, pri neuspehu preklopi na robusten Fetch Fallback.",
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
  const host =
    process.env.RENDER_EXTERNAL_URL ||
    process.env.RENDER_URL ||
    "formio-podnapisinet-addon-1.onrender.com";
  const PUBLIC_URL = `https://${host}`;

  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.0.7, Render-safe Chromium)");
  console.log("💥 Regex prioriteta pri iskanju po naslovu aktivna");
  console.log(`🌐 Manifest: ${PUBLIC_URL}/manifest.json`);
  console.log("==================================================");
});
