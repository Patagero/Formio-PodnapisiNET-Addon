import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

// 🧩 Logger – da vidimo če Stremio res kliče addon
app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;

// 📜 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "11.2.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Hitri iskalnik slovenskih podnapisov s portala Podnapisi.NET",
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

// ⚡ Hitra funkcija za iskanje slovenskih podnapisov brez Puppeteerja
async function fastSearchSubtitles(title) {
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log(`🌍 Hitra poizvedba: ${url}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const subtitles = [];

  // 🔍 Nova struktura
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

// 🎬 Endpoint za Stremio subtitles (pokrije vse oblike URL-jev)
app.get(
  [
    "/subtitles/movie/:imdbId.json",
    "/subtitles/:imdbId.json",
    "/subtitles/movie/:imdbId",
    "/subtitles/:imdbId",
  ],
  async (req, res) => {
    const imdbId = req.params.imdbId;
    console.log("==================================================");
    console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

    const title = await getTitleFromIMDb(imdbId);
    const results = await fastSearchSubtitles(title);

    if (!results.length) {
      return res.json({ subtitles: [] });
    }

    const subtitles = results.map((r, i) => ({
      id: `formio-${i + 1}`,
      lang: "sl",
      url: r.link,
      name: `${r.name} 🇸🇮`,
    }));

    res.json({ subtitles });
  }
);

// 🔁 Root preusmeri na manifest
app.get("/", (_, res) => res.redirect("/manifest.json"));

// 🚀 Zaženi strežnik
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v11.2.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
