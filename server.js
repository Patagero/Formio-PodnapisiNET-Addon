import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

const PODNAPISI_USER = process.env.PODNAPISI_USER || "patagero";
const PODNAPISI_PASS = process.env.PODNAPISI_PASS || "Formio1978";

// 🔧 Launch Puppeteer (Render-safe + local)
async function launchBrowser() {
  const executablePath = (await chromium.executablePath()) || undefined;
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
  return browser;
}

// 🔍 Scrape subtitles by movie title
async function scrapeSubtitlesByTitle(title) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);
  console.log("🔐 Prijava v podnapisi.net ...");

  try {
    // 1️⃣ Prijava
    await page.goto("https://www.podnapisi.net/sl/login", {
      waitUntil: "networkidle2",
      timeout: 30000,
    });
    await page.type('input[name="username"]', PODNAPISI_USER);
    await page.type('input[name="password"]', PODNAPISI_PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);
    console.log("✅ Prijava uspešna");

    // 2️⃣ Iskanje po naslovu
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
      title
    )}&language=sl`;
    console.log(`🔎 Iskanje: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // Počakaj, da se rezultati res naložijo
    await page.waitForSelector("tr.subtitle-entry", { timeout: 20000 }).catch(() => {
      console.warn("⚠️ subtitle-entry elementi se niso pojavili v 20s");
    });

    // 3️⃣ Preberi rezultate
    const subtitles = await page.$$eval("tr.subtitle-entry", rows =>
      rows.map(row => {
        const language = row.querySelector("img.flag")?.alt?.trim();
        const title = row.querySelector("a[href*='/subtitles/']")?.innerText?.trim();
        const link = row.querySelector("a[href*='/subtitles/']")?.href;
        const download = row.querySelector("a[href*='/subtitleserve/sub/']")?.href;
        return { title, language, link, download };
      })
    );

    const slSubtitles = subtitles.filter(
      s => s.language && s.language.toLowerCase().includes("slovenian")
    );

    console.log(`✅ Najdenih ${slSubtitles.length} slovenskih podnapisov`);
    await browser.close();

    if (slSubtitles.length === 0) throw new Error("Ni slovenskih rezultatov");
    return slSubtitles;
  } catch (err) {
    console.error("❌ Napaka pri scrapanju:", err.message);
    await browser.close();
    return { error: "scrape_failed" };
  }
}

// 🎬 Glavni endpoint
app.get("/subtitles/movie/:query.json", async (req, res) => {
  const query = req.params.query;
  console.log(`🎬 IMDb → Naslov: ${query}`);

  try {
    const results = await scrapeSubtitlesByTitle(query);
    res.json(results);
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err);
    res.json({ error: "scrape_failed" });
  }
});

// 🌐 Root info
app.get("/", (req, res) => {
  res.send("✅ Formio Podnapisi.NET 🇸🇮 V9.3.0 deluje lokalno in na Renderju!");
});

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 V9.3.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
