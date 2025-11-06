import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const app = express();
const PORT = process.env.PORT || 10000;

// ✅ Omogoči CORS za Stremio
app.use(cors({
  origin: "*",
  methods: ["GET"]
}));

// 🔐 Prijava v podnapisi.net
const PODNAPISI_USER = "patagero";
const PODNAPISI_PASS = "Formio1978";

// 📄 Scraper za podnapisi.net
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    // Prijava
    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/users/sign_in", { waitUntil: "networkidle2" });
    await page.type("#user_username", PODNAPISI_USER);
    await page.type("#user_password", PODNAPISI_PASS);
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);
    console.log("✅ Prijava uspešna");

    // Iskanje po naslovu
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
    console.log(`🔎 Iskanje: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    // Počakaj, da se prikažejo rezultati
    await page.waitForSelector(".subtitle-entry", { timeout: 6000 }).catch(() => {});
    const subtitles = await page.$$eval(".subtitle-entry", nodes => nodes.map(n => ({
      title: n.querySelector(".release")?.innerText?.trim(),
      link: n.querySelector("a")?.href,
    })));

    const slSubtitles = subtitles.filter(s => s && s.title);
    console.log(`✅ Najdenih ${slSubtitles.length} slovenskih podnapisov`);

    if (slSubtitles.length > 0) {
      console.log("📦 Pridobivanje ZIP povezav ...");
      const zipLinks = await Promise.all(slSubtitles.map(async s => {
        try {
          const res = await fetch(s.link);
          const html = await res.text();
          const match = html.match(/https:\/\/www\.podnapisi\.net\/static\/ftp\/[^"]+\.zip/);
          return match ? { ...s, zip: match[0] } : null;
        } catch {
          return null;
        }
      }));

      const finalSubs = zipLinks.filter(z => z && z.zip);
      console.log(`✅ Končan scraping – ${finalSubs.length} ZIP povezav`);
      await browser.close();
      return finalSubs;
    }

    await browser.close();
    return [];
  } catch (err) {
    console.error("❌ Napaka pri scrapanju:", err.message);
    await browser.close();
    return { error: "scrape_failed" };
  }
}

// 📜 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "formio.podnapisinet",
    version: "9.7.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskalnik slovenskih podnapisov (Render-safe, Chromium fix)",
    types: ["movie"],
    resources: [{
      name: "subtitles",
      types: ["movie"],
      idPrefixes: ["tt"]
    }],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  });
});

// 🎬 Endpoint za iskanje podnapisov
app.get("/subtitles/movie/:title.json", async (req, res) => {
  const { title } = req.params;
  try {
    const results = await scrapeSubtitlesByTitle(title);
    res.json(results);
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err);
    res.json({ error: "scrape_failed" });
  }
});

// 🔁 Root redirect
app.get("/", (req, res) => res.redirect("/manifest.json"));

// 🚀 Zagon
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 V9.7.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
