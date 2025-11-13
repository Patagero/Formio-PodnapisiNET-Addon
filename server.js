import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;

// 📜 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "11.6.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description:
      "Samodejni iskalnik slovenskih podnapisov s portala Podnapisi.NET (izboljšano iskanje)",
    logo: "https://www.podnapisi.net/favicon.ico",
    resources: [
      {
        name: "subtitles",
        types: ["movie", "series"],
        idPrefixes: ["tt"],
      },
    ],
    types: ["movie", "series"],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
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

// ⚡ IZBOLJŠANA FUNKCIJA – 4 nivoji (CSS, regex, tbody, zip/srt)
async function fastSearchSubtitles(title) {
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
    title
  )}&language=sl`;
  console.log(`🌍 Hitra poizvedba: ${url}`);

  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  const html = await res.text();
  const $ = cheerio.load(html);

  const subtitles = [];

  // 1️⃣ <a href> s /subtitles/ in /download
  $("a[href*='/subtitles/']").each((_, el) => {
    const href = $(el).attr("href");
    const name = $(el).text().trim() || "Neznan";
    if (href && href.includes("/download")) {
      const fullLink = href.startsWith("http")
        ? href
        : "https://www.podnapisi.net" + href;
      subtitles.push({ name, link: fullLink });
    }
  });

  // 2️⃣ Regex fallback
  if (subtitles.length === 0) {
    console.log("⚠️ CSS parsing ni vrnil rezultatov, preklapljam na regex ...");
    const regex =
      /href="(\/sl\/subtitles\/[^"]*\/download)"[^>]*>([^<]+)<\/a>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const name = match[2].trim();
      const link = "https://www.podnapisi.net" + match[1];
      if (name && link) subtitles.push({ name, link });
    }
  }

  // 3️⃣ <tbody> parsing
  if (subtitles.length === 0) {
    $("tbody tr").each((_, el) => {
      const link = $(el).find("a[href*='/download']").attr("href");
      const name = $(el).find("a[href*='/download']").text().trim();
      if (link && name)
        subtitles.push({
          name,
          link: link.startsWith("http")
            ? link
            : "https://www.podnapisi.net" + link,
        });
    });
  }

  // 4️⃣ .zip / .srt fallback
  if (subtitles.length === 0) {
    const deepRegex =
      /href="(\/sl\/subtitles\/[^"]*(?:\.zip|\.srt)[^"]*)".*?>([^<]*)<\/a>/gi;
    let m;
    while ((m = deepRegex.exec(html)) !== null) {
      const name = m[2].trim() || "Neznan";
      const link = "https://www.podnapisi.net" + m[1];
      subtitles.push({ name, link });
    }
  }

  console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov za: ${title}`);
  return subtitles;
}

// 🎬 Endpoint za Stremio subtitles
app.get(
  [
    "/subtitles/movie/:imdbId.json",
    "/subtitles/:imdbId.json",
    "/subtitles/movie/:imdbId/*",
    "/subtitles/:imdbId/*",
  ],
  async (req, res) => {
    console.log("==================================================");

    const imdbId = req.params.imdbId;
    const fullUrl = req.url;

    console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
    console.log(`🧩 Celoten URL: ${fullUrl}`);

    const filenameMatch = decodeURIComponent(fullUrl).match(/filename=([^&]+)/);
    let searchTerm = null;

    if (filenameMatch && filenameMatch[1]) {
      let rawName = decodeURIComponent(filenameMatch[1])
        .replace(/\.[a-z0-9]{2,4}$/i, "")
        .replace(/[\._\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      rawName = rawName.replace(
        /\b(2160p|1080p|720p|480p|4k|uhd|hdr10\+?|hdr|hevc|x264|x265|dvdrip|brrip|remux|bluray|webrip|web-dl|rip|dts|aac|atmos|5\.1|7\.1|truehd|avc|ai|upscale|final|repack|proper|extended|edition|cd\d+|part\d+|slo|slv|ahq|sd|sdr|remastered|uhd|bd|ai_upscale|ahq-?\d+)\b/gi,
        ""
      );

      rawName = rawName.replace(/[\d\-\+x]+/gi, " ");
      const words = rawName
        .split(" ")
        .filter((w) => /^[A-Za-zčćžšđ]/i.test(w) && w.length > 2);
      const simpleName = words.slice(0, 3).join(" ").trim();

      searchTerm = simpleName || rawName || "Titanic";
      console.log(`🎯 Poenostavljeno ime za iskanje: ${searchTerm}`);
    }

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

// 🩺 Health check
app.get("/health", (_, res) => res.send("✅ OK"));

// 🔁 Root preusmeri na manifest
app.get("/", (_, res) => res.redirect("/manifest.json"));

// 🚀 Zaženi strežnik
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v11.6.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
