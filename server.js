import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

// 📁 Stalna mapa za podnapise
const STORAGE_DIR = path.join(process.cwd(), "data", "formio_podnapisi");
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// 📜 Manifest za Stremio
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.1.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// 🎯 Funkcija za iskanje prek njihovega JSON API-ja
async function searchPodnapisi(query, lang = "sl") {
  const apiUrl = `https://www.podnapisi.net/subtitles/search/advanced?keywords=${encodeURIComponent(query)}&language=${lang}&movie_type=&seasons=&episodes=&year=`;
  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json, text/javascript, */*; q=0.01",
    },
  });

  if (!res.ok) {
    console.log("⚠️ API ni dostopen:", res.status);
    return [];
  }

  const text = await res.text();

  // Poskusimo razbrati povezave iz JSON ali HTML fallbacka
  const matchLinks = [...text.matchAll(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g)].map(m => m[0]);
  return matchLinks;
}

// 🧩 Glavna pot za pridobivanje podnapisov
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  let query = id;
  const lang = "sl";

  try {
    // IMDb ID → naslov
    if (id.startsWith("tt")) {
      const omdbRes = await fetch(`https://www.omdbapi.com/?i=${id}&apikey=thewdb`);
      const omdbData = await omdbRes.json();
      if (omdbData?.Title) query = omdbData.Title;
    }

    console.log(`🔍 Iščem podnapise za: ${query}`);

    const movieDir = path.join(STORAGE_DIR, query);
    if (!fs.existsSync(movieDir)) fs.mkdirSync(movieDir, { recursive: true });

    // Preveri, če obstaja lokalna .srt datoteka
    const existing = fs.readdirSync(movieDir).find(f => f.endsWith(".srt"));
    if (existing) {
      const fileUrl = `${req.protocol}://${req.get("host")}/files/${encodeURIComponent(query)}/${encodeURIComponent(existing)}`;
      console.log(`📜 Najdeni lokalni podnapisi: ${existing}`);
      return res.json({
        subtitles: [
          { id: "formio-podnapisi", url: fileUrl, lang: "sl", name: "Formio Podnapisi.NET" }
        ]
      });
    }

    // 🔎 Poišči nove povezave
    const links = await searchPodnapisi(query, lang);
    if (!links.length) {
      console.log("⚠️ Ni bilo najdenih povezav v API odgovoru.");
      return res.json({ subtitles: [] });
    }

    const first = "https://www.podnapisi.net" + links[0];
    console.log(`✅ Najden prenos: ${first}`);

    // 📦 Prenesi in razpakiraj ZIP
    const zipPath = path.join(movieDir, `${query}.zip`);
    const zipBuf = Buffer.from(await (await fetch(first)).arrayBuffer());
    fs.writeFileSync(zipPath, zipBuf);

    const zip = new AdmZip(zipPath);
    zip.extractAllTo(movieDir, true);

    const srtFile = fs.readdirSync(movieDir).find(f => f.toLowerCase().endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️ Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    const fileUrl = `${req.protocol}://${req.get("host")}/files/${encodeURIComponent(query)}/${encodeURIComponent(srtFile)}`;
    console.log(`📜 Podnapisi pripravljeni: ${srtFile}`);

    res.json({
      subtitles: [
        { id: "formio-podnapisi", url: fileUrl, lang: "sl", name: "Formio Podnapisi.NET" }
      ]
    });
  } catch (err) {
    console.error("❌ Napaka:", err);
    res.json({ subtitles: [] });
  }
});

// 🗂 Strežnik za pošiljanje datotek
app.get("/files/:movie/:file", (req, res) => {
  const abs = path.resolve(STORAGE_DIR, req.params.movie, req.params.file);
  if (!fs.existsSync(abs)) {
    return res.status(404).send("❌ Subtitle not found");
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(abs);
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Strežnik
const PORT = process.env.PORT || 7760;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
