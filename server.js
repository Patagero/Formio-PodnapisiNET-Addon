import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

const STORAGE_DIR = path.join(process.cwd(), "data", "formio_podnapisi");
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// 📜 Manifest za Stremio
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.3.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov iz podnapisi.net glede na film ali serijo v Stremiu",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// 🧠 Pretvori IMDb ID → naslov filma prek OMDb API
async function getTitleFromIMDB(imdbID) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbID}&apikey=thewdb`);
    const data = await res.json();
    return data?.Title || imdbID;
  } catch {
    return imdbID;
  }
}

// 🔍 Išči podnapise po naslovu
async function searchPodnapisi(title, lang = "sl") {
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${lang}`;
  console.log(`🌍 Iščem na: ${searchUrl}`);

  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0",
        "Accept-Language": "sl,en;q=0.8",
      }
    });
    const html = await res.text();
    const matches = [...html.matchAll(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g)].map(m => m[0]);
    console.log(`🔗 Najdenih povezav: ${matches.length}`);
    return matches;
  } catch (err) {
    console.error("❌ Napaka pri iskanju:", err);
    return [];
  }
}

// 🧩 Glavni route za Stremio
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbID = req.params.id;
  const lang = "sl";
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbID}`);

  let query = imdbID;
  if (imdbID.startsWith("tt")) {
    query = await getTitleFromIMDB(imdbID);
    console.log(`🔍 IMDb → naslov: ${query}`);
  }

  const movieDir = path.join(STORAGE_DIR, query);
  if (!fs.existsSync(movieDir)) fs.mkdirSync(movieDir, { recursive: true });

  // Preveri ali že obstaja razpakiran .srt
  const existing = fs.readdirSync(movieDir).find(f => f.endsWith(".srt"));
  if (existing) {
    const fileUrl = `${req.protocol}://${req.get("host")}/files/${encodeURIComponent(query)}/${encodeURIComponent(existing)}`;
    console.log(`📜 Uporabljam obstoječi SRT: ${existing}`);
    return res.json({
      subtitles: [{ id: "formio-podnapisi", url: fileUrl, lang, name: "Formio Podnapisi.NET" }]
    });
  }

  const links = await searchPodnapisi(query, lang);
  if (!links.length) {
    console.log("⚠️ Ni bilo najdenih podnapisov.");
    return res.json({ subtitles: [] });
  }

  const firstLink = "https://www.podnapisi.net" + links[0];
  console.log(`✅ Najden prenos: ${firstLink}`);

  try {
    const zipBuf = Buffer.from(await (await fetch(firstLink)).arrayBuffer());
    const zipPath = path.join(movieDir, `${query}.zip`);
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
      subtitles: [{ id: "formio-podnapisi", url: fileUrl, lang, name: "Formio Podnapisi.NET" }]
    });
  } catch (err) {
    console.error("❌ Napaka pri prenosu/razpakiranju:", err);
    res.json({ subtitles: [] });
  }
});

// 📂 Strežba .srt datotek
app.get("/files/:movie/:file", (req, res) => {
  const absPath = path.resolve(STORAGE_DIR, req.params.movie, req.params.file);
  if (!fs.existsSync(absPath)) return res.status(404).send("❌ Subtitle not found");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.sendFile(absPath);
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Zagon
const PORT = process.env.PORT || 7760;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
