import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { JSDOM } from "jsdom";

const app = express();
app.use(cors());
app.use(express.json());

// 📁 Stalna mapa za podnapise
const STORAGE_DIR = path.join(process.cwd(), "data", "formio_podnapisi");
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// 📜 Manifest za Stremio
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.9",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// 🧩 Glavna funkcija za pridobivanje podnapisov
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

    // Če podnapisi že obstajajo
    const existing = fs.readdirSync(movieDir).find(f => f.toLowerCase().endsWith(".srt"));
    if (existing) {
      const fileUrl = `${req.protocol}://${req.get("host")}/files/${encodeURIComponent(query)}/${encodeURIComponent(existing)}`;
      console.log(`📜 Najdeni lokalni podnapisi: ${existing}`);
      return res.json({
        subtitles: [
          { id: "formio-podnapisi", url: fileUrl, lang: "sl", name: "Formio Podnapisi.NET" }
        ]
      });
    }

    // Išči na podnapisi.net
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(query)}&language=${lang}`;
    const html = await (await fetch(searchUrl)).text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Poišči vse vrstice tabele z rezultati
    const rows = [...document.querySelectorAll("table tr")];
    const links = rows
      .map(row => {
        const a = row.querySelector("a[href*='/sl/subtitles/']");
        return a ? a.href : null;
      })
      .filter(Boolean);

    if (links.length === 0) {
      console.log("⚠️ Ni bilo najdenih povezav.");
      return res.json({ subtitles: [] });
    }

    const firstLink = "https://www.podnapisi.net" + links[0] + "/download";
    console.log(`✅ Najden prenos: ${firstLink}`);

    // Prenesi ZIP
    const zipPath = path.join(movieDir, `${query}.zip`);
    const zipBuf = Buffer.from(await (await fetch(firstLink)).arrayBuffer());
    fs.writeFileSync(zipPath, zipBuf);

    // Razpakiraj ZIP
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(movieDir, true);

    // Najdi .srt datoteko
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

// 🗂 Strežnik za pošiljanje .srt datotek
app.get("/files/:movie/:file", (req, res) => {
  try {
    const absolutePath = path.resolve(STORAGE_DIR, req.params.movie, req.params.file);
    if (!fs.existsSync(absolutePath)) {
      console.log("❌ Subtitle not found:", absolutePath);
      return res.status(404).send("❌ Subtitle not found");
    }

    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.sendFile(absolutePath, err => {
      if (err) {
        console.error("❌ Napaka pri pošiljanju:", err);
        res.status(500).send("Internal Server Error");
      }
    });
  } catch (err) {
    console.error("❌ Napaka pri dostopu do datoteke:", err);
    res.status(500).send("Internal Server Error");
  }
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Zaženi strežnik
const PORT = process.env.PORT || 7760;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
