import express from "express";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium-min";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 10000;

// 🔐 Prijava za podnapisi.net (v Renderju lahko nastaviš kot Environment Variables)
const PODNAPISI_USER = process.env.PODNAPISI_USER || "patagero";
const PODNAPISI_PASS = process.env.PODNAPISI_PASS || "Formio1978";

// ⚙️ Render-safe Puppeteer launcher
async function launchBrowser() {
  const executablePath = await chromium.executablePath();
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
  return browser;
}

// 🔍 Glavna funkcija: prijava + iskanje + prenos podnapisov
async function scrapeSubtitlesByTitle(title) {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);
  console.log("🔐 Prijava v podnapisi.net ...");

  try {
    // 1️⃣ Prijava
    await page.goto("https://www.podnapisi.net/sl/login", {
      waitUntil: "networkidle2",
      timeout: 40000,
    });
    await page.type('input[name="username"]', PODNAPISI_USER);
    await page.type('input[name="password"]', PODNAPISI_PASS);
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 40000 }),
    ]);
    console.log("✅ Prijava uspešna");

    // 2️⃣ Iskanje po naslovu
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
      title
    )}&language=sl`;
    console.log(`🔎 Iskanje: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 40000 });
    await page.waitForSelector("tr.subtitle-entry", { timeout: 20000 }).catch(() => {
      console.warn("⚠️ subtitle-entry elementi se niso pojavili pravočasno");
    });

    // 3️⃣ Zajem rezultatov
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

    // 4️⃣ Prenos ZIP datotek
    const downloadDir = "/tmp/subtitles";
    if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir);

    for (const sub of slSubtitles) {
      if (sub.download) {
        try {
          const fileName = sub.title
            ? sub.title.replace(/[\\/:*?"<>|]/g, "_") + ".zip"
            : "unknown.zip";
          const filePath = path.join(downloadDir, fileName);

          console.log(`⬇️  Prenašam: ${sub.download}`);
          const response = await fetch(sub.download);
          const buffer = await response.arrayBuffer();
          fs.writeFileSync(filePath, Buffer.from(buffer));
          sub.localPath = filePath;
          sub.downloaded = true;
          console.log(`✅ Shranjeno: ${filePath}`);
        } catch (err) {
          console.error(`❌ Napaka pri prenosu ${sub.title}:`, err.message);
          sub.downloaded = false;
        }
      }
    }

    await browser.close();
    return slSubtitles;
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
    version: "9.6.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskalnik slovenskih podnapisov (Render-safe)",
    types: ["movie"],
    resources: [
      {
        name: "subtitles",
        types: ["movie"],
        idPrefixes: ["tt"],
      },
    ],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
  });
});

// 🎬 Endpoint za iskanje podnapisov
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

// 🔁 Root → preusmeritev na manifest
app.get("/", (req, res) => res.redirect("/manifest.json"));

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 V9.6.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
