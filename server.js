import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

// 📁 Kje se shranjujejo datoteke
const STORAGE_DIR = path.join(process.cwd(), "data", "formio_podnapisi");
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// 📜 Manifest za Stremio
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.2.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov iz podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// 🔍 HTML iskanje s headerji, ki posnemajo pravega uporabnika
async function searchPodnapisi(query, lang = "sl") {
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(query)}&language=${lang}`;
  console.log(`🌍 Povezujem na ${searchUrl}`);

  try {
    const res = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:119.0) Gecko/20100101 Firefox/119.0",
        "Accept-Language": "sl-SI,sl;q=0.9,en;q=0.8",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Connection": "keep-alive",
      },
    });

    const html = await res.text();

    if (!html || html.length < 1000) {
      console.log("⚠️ HTML je prazen (morda blokiran z Cloudflare).");
      return [];
    }

    // Poiščemo vse povezave do /download
    const matches = [...html.matchAll(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g)].map(m => m[0]);
    console.log(`🔗 Najdenih povezav: ${matches.length}`);
    return matches;
  } catch (err) {
    console.error("❌ Napaka pri iskanju:", err);
    return [];
  }
}

// 🎬 Glavna pot za Stremio
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  let query = id;
  const lang = "sl";

  try {
    // IMDb ID → naslov filma
    if (id.startsWith("tt")) {
      const omdbRes = await fetch(`https://www.omdbapi.com/?i=${id}&apikey=thewdb`);
      const omdbData = await omdbRes.json();
      if (omdbData?.Title) query = omdbData.Title;
    }

    console.log(`🔍 Iščem podnapise za: ${query}`);

    const movieDir = path.join(STORAGE_DIR, query);
    if (!fs.existsSync(movieDir)) fs.mkdirSync(movieDir, { recursive: true });

    // Če že obstaja SRT datoteka
    const existing = fs.readdirSync(movieDir).find(f => f.endsWith(".srt"));
    if (existing) {
      const fileUrl = `${req.protocol}://${req.get("host")}/files/${encodeURIComponent(query)}/${encodeURIComponent(existing)}`;
      console.log(`📜 Uporabljam lokalne podnapise: ${existing}`);
      return res.json({
        subtitles: [
          { id: "formio-podnapisi", url: fileUrl, lang: "sl", name: "Formio Podnapisi.NET" }
        ]
      });
    }

    // Poišči povezave na podnapisi.net
    const links = await searchPodnapisi(query, lang);
    if (!links.length) {
      console.log("⚠️ Ni bilo najdenih povezav.");
      return res.json({ subtitles: [] });
    }

    const firstLink = "https://www.podnapisi.net" + links[0];
    console.log(`✅ Najden prenos: ${firstLink}`);

    // Prenesi ZIP
    const zipPath = path.join(movieDir, `${query}.zip`);
    const zipBuf = Buffer.from(await (await fetch(firstLink)).arrayBuffer());
    fs.writeFileSync(zipPath, zipBuf);

    // Razpakiraj ZIP
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(movieDir, true);

    // Poišči .srt datoteko
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

// 🗂 Pošiljanje .srt datotek
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
