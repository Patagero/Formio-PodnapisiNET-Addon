import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

// 🧩 Logger — vidimo vse Stremio zahteve
app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;

// 📜 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "11.3.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Samodejni iskalnik slovenskih podnapisov s portala Podnapisi.NET",
    logo: "https://www.podnapisi.net/favicon.ico",
    resources: [
      {
        name: "subtitles",
        types: ["movie", "series"],
        idPrefixes: ["tt"]
      }
    ],
    types: ["movie", "series"],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  });
});

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

// ⚡ Hitra funkcija za iskanje slovenskih podnapisov (cheerio)
async function fastSearchSubtitles(title) {
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log(`🌍 Hitra poizvedba: ${url}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const subtitles = [];

  $("article.subtitle-entry").each((_, el) => {
    const name =
      $(el).find(".release").text().trim() ||
      $(el).find("h3").text().trim() ||
      "Neznan";
    const link =
      $(el).find("a[href*='/sl/subtitles/']").attr("href") ||
      $(el).find("a[href*='/download']").attr("href");
    if (link) {
      const fullLink = link.startsWith("http")
        ? link
        : "https://www.podnapisi.net" + link;
      subtitles.push({ name, link: fullLink });
    }
  });

  // 🧩 Fallback regex parsing (če cheerio ne ujame)
  if (subtitles.length === 0) {
    const regex =
      /<a\s+href="(\/sl\/subtitles\/[^"]+\/download)"[^>]*>([^<]+)<\/a>/g;
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

// 🎬 Endpoint za Stremio subtitles (ujame vse oblike + filename iskanje)
app.get(
  [
    "/subtitles/movie/:imdbId.json",
    "/subtitles/:imdbId.json",
    "/subtitles/movie/:imdbId/*",
    "/subtitles/:imdbId/*"
  ],
  async (req, res) => {
    console.log("==================================================");

    const imdbId = req.params.imdbId;
    const fullUrl = req.url;

    console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
    console.log(`🧩 Celoten URL: ${fullUrl}`);

    // 📂 Izluščimo filename iz query dela
    const filenameMatch = decodeURIComponent(fullUrl).match(/filename=([^&]+)/);
    let searchTerm = null;

    if (filenameMatch && filenameMatch[1]) {
      searchTerm = filenameMatch[1]
        .replace(/\.[a-z0-9]{2,4}$/i, "")
        .replace(/[\._]/g, " ")
        .replace(/\s+/g, " ")
        .replace(/2160p|1080p|720p|bluray|remux|uhd|hdr|dts|x264|x265|hevc|dvdrip|brrip/gi, "")
        .trim();
      console.log(`📂 Iščem po imenu datoteke: ${searchTerm}`);
    }

    // Če filename ni prisoten, iščemo po IMDb naslovu
    if (!searchTerm) {
      searchTerm = await getTitleFromIMDb(imdbId);
      console.log(`🎬 Iščem po IMDb naslovu: ${searchTerm}`);
    }

    const results = await fastSearchSubtitles(searchTerm);

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
  }
);

// 🔁 Root preusmeri na manifest
app.get("/", (_, res) => res.redirect("/manifest.json"));

// 🚀 Zaženi strežnik
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v11.3.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
