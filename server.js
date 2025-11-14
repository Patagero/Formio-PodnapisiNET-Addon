import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;

// 🎬 IMDb → naslov (osnovno ime filma)
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

// 🔍 Glavna funkcija za iskanje slovenskih podnapisov
async function scrapeSubtitlesByTitle(title) {
  console.log(`🌍 Iščem slovenske podnapise za: ${title}`);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
    title
  )}&language=sl`;

  // 🧩 Najprej poskusi hitro metodo z “cheerio”
  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept-Language": "sl,en-US;q=0.9,en;q=0.8",
      },
    });

    const html = await res.text();
    const $ = cheerio.load(html);
    let results = [];

    $(".subtitle-entry, table.table tbody tr").each((_, el) => {
      const link =
        $(el).find("a[href*='/download']").attr("href") ||
        $(el).find("a[href*='/subtitles/']").attr("href");
      const name =
        $(el).find(".release").text().trim() || $(el).find("a").first().text().trim();
      const lang = $(el).text().toLowerCase().includes("slovenski") ? "sl" : "";
      if (link && lang) results.push({ name, link, lang });
    });

    if (results.length > 0) {
      console.log(`✅ Najdenih ${results.length} slovenskih podnapisov (cheerio)`);
      return results;
    } else {
      console.log("⚠️ cheerio parsing ni našel rezultatov, preklop na Puppeteer...");
    }
  } catch (e) {
    console.log("⚠️ Napaka pri fetch iskanju:", e.message);
  }

  // 🕵️ Fallback – Puppeteer (če fetch ne vrne rezultatov)
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
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 45000 });

  let results = [];
  try {
    await page.waitForSelector(".subtitle-entry, table.table tbody tr", { timeout: 8000 });
    results = await page.$$eval(".subtitle-entry, table.table tbody tr", (rows) =>
      rows
        .map((r) => {
          const link =
            r.querySelector("a[href*='/download']")?.href ||
            r.querySelector("a[href*='/subtitles/']")?.href;
          const name = r.querySelector(".release, a")?.textContent?.trim() || "Neznan";
          const lang = r.innerText.toLowerCase().includes("slovenski") ? "sl" : "";
          return link && lang ? { name, link, lang } : null;
        })
        .filter(Boolean)
    );
  } catch {
    console.log("⚠️ Ni bilo mogoče prebrati tabelo rezultatov (tudi z Puppeteer).");
  }

  await browser.close();
  console.log(`✅ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "14.0.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Išče slovenske podnapise samo po imenu filma (cheerio + puppeteer fallback)",
    types: ["movie", "series"],
    resources: [{ name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] }],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// 🎬 Endpoint – vedno išče samo po osnovnem naslovu filma
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
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v14.0.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
