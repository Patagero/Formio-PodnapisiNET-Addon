// ==================================================
// ✅ Formio Podnapisi.NET 🇸🇮 (v10.0.1, združena verzija z iskanjem + filtrom + auto test)
// ==================================================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

// 🔧 pomožna funkcija
const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// ==================================================
// 🔍 Scraper – prijava, iskanje, prenos ZIP
// ==================================================
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    console.log(`🧠 Chromium zagnan iz: ${await chromium.executablePath()}`);

    const page = await browser.newPage();

    // 🔐 Prijava
    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/users/login", { waitUntil: "networkidle2" });
    await page.type("#username", USERNAME);
    await page.type("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    console.log("✅ Prijava uspešna");

    // 🔎 Iskanje
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
    console.log(`🌍 Iskanje: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    const subtitles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".subtitle-entry")).map(el => ({
        title: el.querySelector(".subtitle-entry__title")?.innerText.trim(),
        link: el.querySelector("a.subtitle-entry__download")?.href,
        year: el.querySelector(".subtitle-entry__year")?.innerText.trim(),
      }));
    });

    console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);

    // 🔎 Filtiranje po naslovu
    const normTitle = normalize(title);
    const filtered = subtitles.filter(s => {
      const t = normalize(s.title);
      return t.includes(normTitle) || normTitle.includes(t);
    });

    let finalList = filtered;
    if (filtered.length === 0) {
      console.log("⚠️ Ni ujemanj po naslovu — vračam vse slovenske rezultate.");
      finalList = subtitles;
    }

    console.log(`🧩 Po filtriranju ostane ${finalList.length} 🇸🇮 relevantnih podnapisov.`);

    // 📦 Prenos ZIP povezav
    for (const s of finalList) {
      try {
        const res = await fetch(s.link);
        const html = await res.text();
        const match = html.match(/https:\/\/www\.podnapisi\.net\/static\/ftp\/[^"]+\.zip/);
        if (match) {
          s.zip = match[0];
          console.log(`💾 ZIP: ${s.zip}`);
        }
      } catch {
        console.log(`⚠️ Napaka pri prenosu ZIP za ${s.title}`);
      }
    }

    await browser.close();
    return finalList;
  } catch (err) {
    console.error("❌ Napaka pri scrapanju:", err);
    if (browser) await browser.close();
    return { error: "scrape_failed" };
  }
}

// ==================================================
// 📜 Manifest za Stremio
// ==================================================
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "formio.podnapisinet",
    version: "10.0.1",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskalnik slovenskih podnapisov (Render-safe, z auto testom)",
    types: ["movie"],
    resources: [
      {
        name: "subtitles",
        types: ["movie"],
        idPrefixes: ["tt"],
      },
    ],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// ==================================================
// 🎬 Endpoint za iskanje podnapisov po imenu filma
// ==================================================
app.get("/subtitles/movie/:query.json", async (req, res) => {
  const query = req.params.query.replace(/tt\d+/, "").trim();
  try {
    const results = await scrapeSubtitlesByTitle(query);
    res.json(results);
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err);
    res.json({ error: "scrape_failed" });
  }
});

// ==================================================
// 🔁 Root redirect na manifest
// ==================================================
app.get("/", (req, res) => res.redirect("/manifest.json"));

// ==================================================
// 🧪 Samodejni test ob zagonu (preveri Puppeteer)
// ==================================================
(async () => {
  try {
    console.log("🧪 Preverjam Puppeteer zagnanost...");
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.goto("https://www.podnapisi.net/sl", { waitUntil: "domcontentloaded" });
    console.log("🧪 Puppeteer deluje — povezava uspešna.");
    await browser.close();
  } catch (err) {
    console.error("❌ Puppeteer test ni uspel:", err.message);
  }
})();

// ==================================================
// 💤 Keep-alive ping
// ==================================================
setInterval(() => {
  fetch(`https://formio-podnapisinet-addon-1.onrender.com/manifest.json`).catch(() => {});
}, 10 * 60 * 1000);

// ==================================================
// 🧠 Zagon strežnika
// ==================================================
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 združena verzija posluša na portu ${PORT}`);
  console.log("==================================================");
});
