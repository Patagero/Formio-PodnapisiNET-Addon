import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: "*", methods: ["GET"] }));

const PODNAPISI_USER = "patagero";
const PODNAPISI_PASS = "Formio1978";

// 🔧 Chromium launcher
async function getBrowser() {
  const path = await chromium.executablePath();
  console.log(`🧠 Chromium zagnan iz: ${path}`);
  return await puppeteer.launch({
    args: chromium.args,
    executablePath: path,
    headless: chromium.headless,
    ignoreHTTPSErrors: true
  });
}

// 🔎 Scraper
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/users/sign_in", { waitUntil: "networkidle2" });
    await page.type("#user_username", PODNAPISI_USER);
    await page.type("#user_password", PODNAPISI_PASS);
    await Promise.all([
      page.click('input[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2" })
    ]);
    console.log("✅ Prijava uspešna");

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
    console.log(`🔎 Iskanje: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    await page.waitForSelector(".subtitle-entry", { timeout: 8000 }).catch(() => {});
    const subtitles = await page.$$eval(".subtitle-entry", els =>
      els.map(el => ({
        title: el.querySelector(".release")?.innerText?.trim(),
        link: el.querySelector("a")?.href
      }))
    );

    console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);

    const final = [];
    for (const s of subtitles) {
      try {
        const res = await fetch(s.link);
        const html = await res.text();
        const m = html.match(/https:\/\/www\.podnapisi\.net\/static\/ftp\/[^"]+\.zip/);
        if (m) final.push({ ...s, zip: m[0] });
      } catch {}
    }

    console.log(`✅ Končan scraping – ${final.length} ZIP povezav`);
    await browser.close();
    return final;
  } catch (err) {
    console.error("❌ Napaka pri scrapanju:", err.message);
    await browser.close();
    return { error: "scrape_failed" };
  }
}

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "formio.podnapisinet",
    version: "9.9.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskalnik slovenskih podnapisov (Render-safe, puppeteer 21.6.1)",
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

// 🎬 Endpoint
app.get("/subtitles/movie/:title.json", async (req, res) => {
  const { title } = req.params;
  const results = await scrapeSubtitlesByTitle(title);
  res.json(results);
});

// 🔁 Root redirect
app.get("/", (req, res) => res.redirect("/manifest.json"));

// 🚀 Start
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 V9.9.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
