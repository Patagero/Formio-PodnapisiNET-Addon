import express from "express";
import cors from "cors";
import fetch from "node-fetch";

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
    version: "12.5.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description:
      "Hitri iskalnik slovenskih podnapisov z direktnim API dostopom (avtorizacija included)",
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

// 🎬 IMDb → naslov (če ni imena datoteke)
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

// ⚡ NOVA različica – login + API (brez Puppeteer)
async function fastSearchSubtitles(title) {
  console.log(`🌍 Prijava in API poizvedba za: ${title}`);

  const loginUrl = "https://www.podnapisi.net/sl/login";
  const apiUrl = `https://www.podnapisi.net/api/subtitles?keywords=${encodeURIComponent(
    title
  )}&language=sl`;

  const loginData = new URLSearchParams();
  loginData.append("username", "patagero");
  loginData.append("password", "Formio1978");

  try {
    // 🔐 1️⃣ Login za piškotke
    const loginRes = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "text/html,application/xhtml+xml",
      },
      body: loginData.toString(),
      redirect: "manual",
    });

    const cookies = loginRes.headers.raw()["set-cookie"];
    if (!cookies) {
      console.log("⚠️ Prijava ni vrnila cookiejev – preveri login.");
      return [];
    }
    const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

    // 🔎 2️⃣ API poizvedba z avtorizacijo
    const apiRes = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookieHeader,
      },
    });

    if (!apiRes.ok) {
      console.log(`⚠️ API napaka: ${apiRes.status}`);
      return [];
    }

    const json = await apiRes.json();
    if (!json?.data || !Array.isArray(json.data)) {
      console.log("⚠️ API ni vrnil veljavnih rezultatov");
      return [];
    }

    const subtitles = json.data
      .filter((sub) => sub.language?.slug === "sl")
      .map((sub) => ({
        name: sub.release || sub.title || "Neznan",
        link: `https://www.podnapisi.net${sub.url}`,
      }));

    console.log(`✅ Najdenih ${subtitles.length} 🇸🇮 podnapisov za: ${title}`);
    return subtitles;
  } catch (err) {
    console.error("❌ Napaka pri prijavi ali iskanju:", err.message);
    return [];
  }
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

    // 🔍 Ugotovi iskalni niz iz imena datoteke
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
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v12.5.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
