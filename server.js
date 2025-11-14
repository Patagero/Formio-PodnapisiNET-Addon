import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;

// 🎬 IMDb → naslov (brez letnice)
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return data.Title.trim();
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// 🔍 Iskanje slovenskih podnapisov (HTML + Puppeteer fallback)
async function scrapeSubtitlesByTitle(title) {
  console.log(`🌍 Iščem slovenske podnapise za: ${title}`);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
    title
  )}&language=sl`;

  // 🧩 1. Hiter poskus – fetch + cheerio
  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept-Language": "sl,en-US;q=0.9,en;q=0.8",
      },
    });

    const html = await res.text();
    const cheerio = await import("cheerio");
    const $ = cheerio.load(html);
    const results = [];

    $("table.table tbody tr").each((_, row) => {
      const link =
        $(row).find("a[href*='/download']").attr("href") ||
        $(row).find("a[href*='/subtitles/']").attr("href");
      const name = $(row).find("a").first().text().trim();
      const lang = $(row).text().toLowerCase().includes("slovenski") ? "sl" : "";
      if (link && lang)
        results.push({ name, link: `https://www.podnapisi.net${link}`, lang });
    });

    if (results.length > 0) {
      console.log(`✅ Najdenih ${results.length} slovenskih podnapisov (HTML fetch)`);
      return results;
    } else {
      console.log("⚠️ Ni rezultatov s fetch metodo – preklop na Puppeteer fallback...");
    }
  } catch (err) {
    console.log("⚠️ Napaka pri fetch:", err.message);
  }

  // 🕵️ 2. Puppeteer fallback
  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
  );
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 45000 });

  const results = await page.$$eval("table.table tbody tr", (rows) =>
    rows
      .map((r) => {
        const link =
          r.querySelector("a[href*='/download']")?.href ||
          r.querySelector("a[href*='/subtitles/']")?.href;
        const name = r.querySelector("a")?.textContent?.trim() || "Neznan";
        const lang = r.innerText.toLowerCase().includes("slovenski") ? "sl" : "";
        return link && lang ? { name, link, lang } : null;
      })
      .filter(Boolean)
  );

  await browser.close();
  console.log(`✅ Najdenih ${results.length} slovenskih podnapisov (Puppeteer fallback)`);
  return results;
}

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "16.0.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description:
      "Hiter iskalnik slovenskih podnapisov po imenu filma (HTML + Puppeteer fallback)",
    types: ["movie", "series"],
    resources: [{ name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] }],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// 🎬 Endpoint za Stremio
app.get("/subtitles/:type/:imdbId/*", async (req, res) => {
  console.log("==================================================");
  const imdbId = req.params.imdbId;
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

  const searchTerm = await getTitleFromIMDb(imdbId);
  console.log(`🎯 Iščem samo po imenu filma: ${searchTerm}`);

  const results = await scrapeSubtitlesByTitle(searchTerm);

  if (!results.length) {
    console.log(`❌ Ni najdenih podnapisov za: ${searchTerm}`);
    return res.json({ subtitles: [] });
  }

  const subtitles = results.map((r, i) => ({
    id: `formio-${i + 1}`,
    lang: "sl",
    url: r.link,
    name: `${r.name} 🇸🇮`,
  }));

  console.log(`📦 Pošiljam ${subtitles.length} podnapisov`);
  res.json({ subtitles });
});

app.get("/health", (_, res) => res.send("✅ OK"));
app.get("/", (_, res) => res.redirect("/manifest.json"));

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v16.0.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
