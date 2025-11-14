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

// 🔍 Iskanje podnapisov z “XHR intercept” (hitro in zanesljivo)
async function scrapeSubtitlesByTitle(title) {
  console.log(`🌍 Iščem slovenske podnapise za: ${title}`);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
    title
  )}&language=sl`;

  const browser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled"
    ],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
  );

  let results = [];

  try {
    // 🎯 prestrezamo XHR zahtevke
    page.on("response", async (response) => {
      const url = response.url();
      if (url.includes("/api/subtitles") && response.status() === 200) {
        try {
          const data = await response.json();
          const subs = data.data || data;
          results = subs
            .filter((s) => s.language?.toLowerCase().includes("sl"))
            .map((s) => ({
              name: s.release || s.title || "Neznan",
              link: `https://www.podnapisi.net${s.url}`,
              lang: "sl"
            }));
        } catch (err) {
          console.log("⚠️ Napaka pri branju API odgovora:", err.message);
        }
      }
    });

    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 3500));
  } catch (err) {
    console.log("❌ Napaka pri Puppeteer iskanju:", err.message);
  }

  await browser.close();
  console.log(`✅ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "15.0.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Hiter iskalnik slovenskih podnapisov po imenu filma (XHR intercept)",
    types: ["movie", "series"],
    resources: [{ name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] }],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false }
  });
});

// 🎬 Endpoint
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
    name: `${r.name} 🇸🇮`
  }));

  console.log(`📦 Pošiljam ${subtitles.length} podnapisov`);
  res.json({ subtitles });
});

app.get("/health", (_, res) => res.send("✅ OK"));
app.get("/", (_, res) => res.redirect("/manifest.json"));

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v15.0.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
