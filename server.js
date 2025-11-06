// ==================================================
//  Formio Podnapisi.NET 🇸🇮 — verzija V8.5.0
//  Prijava + dinamično iskanje slovenskih podnapisov + download povezave
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

// TMP mapa
const TMP_DIR = path.join(os.tmpdir(), "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// --------------------------------------------------
// 🔐 Prijava v podnapisi.net (patagero / Formio1978)
// --------------------------------------------------
async function loginToPodnapisi() {
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
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
  ]);

  console.log("✅ Prijava uspešna");
  return { browser, page };
}

// --------------------------------------------------
// 🔍 Iskanje slovenskih podnapisov po IMDb ID ali naslovu
// --------------------------------------------------
async function scrapeSubtitles(imdbId) {
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
  const { browser, page } = await loginToPodnapisi();

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${imdbId}`;
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  // Počakaj, da se naložijo dinamični rezultati (prek AJAX-a)
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("tr.subtitle-entry").length > 0,
      { timeout: 20000 }
    );
  } catch {
    console.warn("⚠️ Ni bilo mogoče najti rezultatov (morda prazen seznam)");
  }

  // Zberi osnovne podatke o podnapisih
  const subtitles = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("tr.subtitle-entry"));
    return rows
      .map((row) => {
        const title = row.querySelector(".release")?.textContent?.trim();
        const lang = row.querySelector(".language")?.textContent?.trim();
        const link = row.querySelector('a[href*="/subtitles/"]')?.getAttribute("href");
        return { title, lang, href: link ? `https://www.podnapisi.net${link}` : null };
      })
      .filter((s) => s.lang && s.lang.toLowerCase().includes("slov"));
  });

  console.log(`🧩 Najdenih ${subtitles.length} slovenskih podnapisov (osnovno)`);

  // Obišči posamezne strani, da dobiš dejanske ZIP povezave
  const results = [];
  for (const sub of subtitles) {
    if (!sub.href) continue;
    try {
      const subPage = await browser.newPage();
      await subPage.goto(sub.href, { waitUntil: "domcontentloaded", timeout: 15000 });
      const dl = await subPage.evaluate(() => {
        const a = document.querySelector('a[href*="/subtitle/download/"]');
        return a ? a.getAttribute("href") : null;
      });
      if (dl) {
        results.push({
          title: sub.title,
          lang: sub.lang,
          download: `https://www.podnapisi.net${dl}`,
        });
        console.log(`💾 ${sub.title} → ${dl}`);
      }
      await subPage.close();
    } catch (err) {
      console.warn(`⚠️ Napaka pri podnapisu ${sub.title}:`, err.message);
    }
  }

  await browser.close();
  console.log(`✅ Končan scraping – ${results.length} slovenskih ZIP povezav`);
  return results;
}

// --------------------------------------------------
// 🌐 API endpoint
// --------------------------------------------------
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  try {
    const subtitles = await scrapeSubtitles(imdbId);
    res.json({ subtitles });
  } catch (err) {
    console.error("❌ Napaka pri iskanju:", err);
    res.status(500).json({ error: "Scrape failed" });
  }
});

// --------------------------------------------------
// 🧭 Info + manifest
// --------------------------------------------------
app.get("/", (req, res) => {
  res.send(`
    <h1>✅ Formio Podnapisi.NET 🇸🇮 (v8.5.0)</h1>
    <p>Iskanje slovenskih podnapisov + realne ZIP povezave</p>
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
    version: "8.5.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description:
      "Prijava + dinamično iskanje slovenskih podnapisov in realne download povezave.",
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.5.0)");
  console.log("💬 Puppeteer login + ZIP scraping aktiviran");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
