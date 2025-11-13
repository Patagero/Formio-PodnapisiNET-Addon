import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";


const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

// 🎬 IMDb → naslov
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) return data.Title.trim();
  } catch (e) {
    console.log("⚠️ IMDb napaka:", e.message);
  }
  return imdbId;
}

// ⚡ Hitro iskanje brez Puppeteerja
async function fastSearchSubtitles(title) {
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log(`🌍 Hitra poizvedba: ${url}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const subtitles = [];
  $(".subtitle-entry").each((_, el) => {
    const link = $(el).find("a[href*='/download']").attr("href");
    const name = $(el).find(".release").text().trim();
    if (link && name) subtitles.push({ name, link: "https://www.podnapisi.net" + link });
  });

  // fallback regex
  if (subtitles.length === 0) {
    const regex = /href="(\/sl\/subtitles\/[^"]*\/download)"[^>]*>([^<]+)</g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      subtitles.push({
        name: match[2].trim(),
        link: "https://www.podnapisi.net" + match[1],
      });
    }
  }

  console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);
  return subtitles;
}

// 🎬 Glavni Stremio endpoint
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

  const title = await getTitleFromIMDb(imdbId);
  const subs = await fastSearchSubtitles(title);

  const formatted = subs.map((s, i) => ({
    id: `formio-fast-${i}`,
    url: s.link,
    lang: "sl",
    name: `🇸🇮 ${s.name}`,
  }));

  res.json({ subtitles: formatted });
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet.fast",
    version: "11.0.0",
    name: "Formio Podnapisi.NET 🇸🇮 (Fast Mode)",
    description: "Iskalnik slovenskih podnapisov – brez Chromiuma, 10× hitrejši",
    types: ["movie"],
    resources: [
      { name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }
    ],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false }
  });
});

app.get("/", (_, res) => res.redirect("/manifest.json"));

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 (Fast Mode) posluša na portu ${PORT}`);
  console.log("==================================================");
});
