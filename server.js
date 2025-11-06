// ==================================================
//  Formio Podnapisi.NET 🇸🇮  –  V9.2.0
//  Samodejno prevede IMDb ID v naslov in išče po imenu
// ==================================================

import express from "express";
import cors from "cors";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import fetch from "node-fetch";

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

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
// 🎞️ IMDb → Title pretvorba
// --------------------------------------------------
async function imdbToTitle(query) {
  if (!/^tt\d{6,}$/.test(query)) return query; // če ni IMDb ID, vrni kar je

  try {
    const url = `https://www.omdbapi.com/?i=${query}&apikey=564727fa`; // brezplačni OMDb API ključ
    const resp = await fetch(url);
    const data = await resp.json();
    if (data && data.Title) {
      console.log(`🎬 IMDb → Naslov: ${data.Title}`);
      return data.Title;
    }
  } catch (err) {
    console.warn("⚠️ IMDb API ni uspel:", err.message);
  }
  return query; // fallback
}

// --------------------------------------------------
// 🔍 Iskanje po naslovu
// --------------------------------------------------
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  const session = await loginToPodnapisi();
  if (!session) return [];

  const { browser, page } = session;

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log("🔎 Iskanje:", searchUrl);
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });

  // 📄 Preberi rezultate
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
// 🌐 Endpoint: /subtitles/:type/:query.json
// --------------------------------------------------
app.get("/subtitles/:type/:query.json", async (req, res) => {
  try {
    const { query } = req.params;
    const title = await imdbToTitle(query);
    const subs = await scrapeSubtitlesByTitle(title);
    res.json({ title, subtitles: subs });
  } catch (err) {
    console.error("❌ Napaka endpoint:", err.message);
    res.status(500).json({ error: "scrape_failed" });
  }
});

// --------------------------------------------------
// Manifest + root
// --------------------------------------------------
app.get("/", (req, res) => {
  res.send(`<h2>✅ Formio Podnapisi.NET 🇸🇮 V9.2.0</h2>
    <p>Manifest: <a href="/manifest.json">/manifest.json</a></p>`);
});

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.formio.podnapisi",
    version: "9.2.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskanje slovenskih podnapisov po imenu (avtomatska prijava + IMDb pretvorba).",
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
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 V9.2.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
