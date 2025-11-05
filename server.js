// ==================================================
//  Formio Podnapisi.NET 🇸🇮 — verzija V8.2.0
//  Prijava + iskanje slovenskih podnapisov + download povezave
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

// === GLAVNA FUNKCIJA ZA ISKANJE PODNAPISOV ===
async function scrapeSubtitles(imdbId) {
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
  const loginUrl = "https://www.podnapisi.net/sl/login";
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${imdbId}`;

  let executablePath;
  let results = [];

  try {
    executablePath = await chromium.executablePath();
    console.log(`🧠 Chromium zagnan iz: ${executablePath}`);

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
      timeout: 25000,
    });

    const page = await browser.newPage();

    // --- Prijava ---
    if (process.env.PODNAPISI_USER && process.env.PODNAPISI_PASS) {
      console.log("🔐 Prijava v podnapisi.net ...");
      await page.goto(loginUrl, { waitUntil: "networkidle2" });
      await page.type('input[name="username"]', process.env.PODNAPISI_USER, { delay: 50 });
      await page.type('input[name="password"]', process.env.PODNAPISI_PASS, { delay: 50 });
      await Promise.all([
        page.click('button[type="submit"], input[type="submit"]'),
        page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }),
      ]);
      console.log("✅ Prijava uspešna");
    }

    // --- Iskanje slovenskih podnapisov ---
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 15000 });

    results = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tr.subtitle-entry"));
      return rows
        .map((row) => {
          const title = row.querySelector(".release")?.textContent?.trim();
          const lang = row.querySelector(".language")?.textContent?.trim();
          const linkEl = row.querySelector('a[href*="/subtitles/"]');
          const href = linkEl ? linkEl.getAttribute("href") : null;
          return { title, lang, href };
        })
        .filter((x) => x.lang && x.lang.toLowerCase().includes("slovenski"));
    });

    // --- Pridobitev download povezav ---
    for (let sub of results) {
      try {
        if (sub.href) {
          const subUrl = `https://www.podnapisi.net${sub.href}`;
          const subPage = await page.goto(subUrl, { waitUntil: "domcontentloaded" });
          const html = await subPage.text();
          const match = html.match(/href="(\/subtitle\/download\/[^"]+)"/);
          if (match) {
            sub.download = `https://www.podnapisi.net${match[1]}`;
          }
        }
      } catch {}
    }

    await browser.close();
    console.log(`✅ Najdenih ${results.length} slovenskih podnapisov`);
    return results;
  } catch (err) {
    console.error("❌ Napaka Puppeteer:", err.message);
  }

  return results;
}

// === API ZA ISKANJE PODNAPISOV ===
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

// === INFO STRAN ===
app.get("/", (req, res) => {
  res.send(`
    <h1>✅ Formio Podnapisi.NET 🇸🇮 Addon (V8.2.0)</h1>
    <p>Prijava + iskanje slovenskih podnapisov deluje.</p>
    <p>Manifest: <a href="/manifest.json">/manifest.json</a></p>
    <ul>
      <li><a href="/subtitles/movie/tt0120338.json">Titanic (1997)</a></li>
      <li><a href="/subtitles/movie/tt1375666.json">Inception (2010)</a></li>
    </ul>
  `);
});

// === MANIFEST ZA STREMIO ===
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.formio.podnapisi",
    version: "8.2.0",
    name: "Formio Podnapisi.NET 🇸🇮 (Slovenski podnapisi)",
    description:
      "Avtomatska prijava in pridobivanje slovenskih podnapisov za filme na podnapisi.net.",
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.2.0)");
  console.log("💬 Išče slovenske podnapise + prijava aktivna");
  console.log(`🌐 Manifest: ${PUBLIC_URL}/manifest.json`);
  console.log("==================================================");
});
