// ==================================================
//  Formio Podnapisi.NET 🇸🇮  –  V9.1.0
//  Išče po naslovu (ne po IMDb ID-ju)
// ==================================================

import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import path from "path";
import fs from "fs";
import os from "os";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

const TMP_DIR = path.join(os.tmpdir(), "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// --------------------------------------------------
// 🔐 Prijava v podnapisi.net
// --------------------------------------------------
async function loginToPodnapisi() {
  const user = process.env.PODNAPISI_USER || "patagero";
  const pass = process.env.PODNAPISI_PASS || "Formio1978";

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
    timeout: 30000,
  });

  try {
    await page.type('input[name="username"], input[name="login"]', user, { delay: 20 });
    await page.type('input[name="password"]', pass, { delay: 20 });
    await Promise.all([
      page.click('button[type="submit"], input[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
    ]);
    console.log("✅ Prijava uspešna");
    return { browser, page };
  } catch (err) {
    console.error("❌ Napaka pri prijavi:", err.message);
    await browser.close();
    return null;
  }
}

// --------------------------------------------------
// 🔍 Išči po nazivu (npr. "Titanic")
// --------------------------------------------------
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  const session = await loginToPodnapisi();
  if (!session) return [];

  const { browser, page } = session;

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log("🔎 Iskanje:", searchUrl);
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });

  // 📄 Poišči vse zadetke
  const subtitles = await page.evaluate(() => {
    const rows = document.querySelectorAll("tr.subtitle-entry");
    const results = [];
    rows.forEach((row) => {
      const titleEl = row.querySelector("td.release");
      const langEl = row.querySelector("td.language");
      const linkEl = row.querySelector("a[href*='/subtitles/']");
      const lang = langEl ? langEl.innerText.trim() : "";
      if (lang.toLowerCase().includes("slov")) {
        results.push({
          title: titleEl ? titleEl.innerText.trim() : "(neznan naslov)",
          lang,
          download: linkEl ? `https://www.podnapisi.net${linkEl.getAttribute("href")}` : null,
        });
      }
    });
    return results;
  });

  await browser.close();

  console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);
  return subtitles;
}

// --------------------------------------------------
// 🌐 Endpoint: išči po naslovu
// --------------------------------------------------
app.get("/subtitles/:type/:title.json", async (req, res) => {
  try {
    const { title } = req.params;
    const subs = await scrapeSubtitlesByTitle(title);
    res.json({ subtitles: subs });
  } catch (err) {
    console.error("❌ Napaka endpoint:", err.message);
    res.status(500).json({ error: "scrape_failed" });
  }
});

// --------------------------------------------------
// Manifest in root
// --------------------------------------------------
app.get("/", (req, res) => {
  res.send(`<h2>✅ Formio Podnapisi.NET 🇸🇮 V9.1.0</h2>
    <p>Manifest: <a href="/manifest.json">/manifest.json</a></p>`);
});

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.formio.podnapisi",
    version: "9.1.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskanje slovenskih podnapisov po naslovu (avtomatska prijava).",
    types: ["movie", "series"],
    resources: ["subtitles"],
    idPrefixes: ["tt"],
  });
});

// --------------------------------------------------
// Zaženi strežnik
// --------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 V9.1.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
