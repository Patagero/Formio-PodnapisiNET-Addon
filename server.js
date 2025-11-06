import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: "*", methods: ["GET"] }));

const PODNAPISI_USER = "patagero";
const PODNAPISI_PASS = "Formio1978";

// 🔧 Chromium launcher, 100% Render-safe
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  console.log(`🧠 Chromium zagnan iz: ${executablePath}`);

  return await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true
  });
}

// 🎬 Iskanje slovenskih podnapisov
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
    const subtitles = await page.$$eval(".subtitle-entry", nodes =>
      nodes.map(el => ({
        title: el.querySelector(".release")?.innerText?.trim(),
        link: el.querySelector("a")?.href
      }))
    );

    const slSubs = subtitles.filter(s => s?.title);
    console.log(`✅ Najdenih ${slSubs.length} slovenskih podnapisov`);

    const final = [];
    for (const s of slSubs) {
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

// 📜 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "formio.podnapisinet",
    version: "9.8.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskalnik slovenskih podnapisov (Render-safe, puppeteer-core build)",
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

// 🎬 Endpoint za iskanje
app.get("/subtitles/movie/:title.json", async (req, res) => {
  const { title } = req.params;
  const results = await scrapeSubtitlesByTitle(title);
  res.json(results);
});

// 🔁 Root redirect
app.get("/", (req, res) => res.redirect("/manifest.json"));

// 🚀 Zagon
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 V9.8.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
