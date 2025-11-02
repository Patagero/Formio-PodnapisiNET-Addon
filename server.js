import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

// Manifest
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.1",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"],
};

// Pot za začasne datoteke
const TMP_DIR = path.join(process.env.TEMP || "./tmp", "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// Glavna pot za pridobivanje podnapisov
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  const lang = "sl";
  let query = id;

  // 🔍 Če je IMDb ID (npr. tt0120338), pretvori v naslov
  if (id.startsWith("tt")) {
    const omdbKey = "thewdb"; // brezplačni javni API ključ
    const omdbUrl = `https://www.omdbapi.com/?i=${id}&apikey=${omdbKey}`;
    const omdbRes = await fetch(omdbUrl);
    const omdbData = await omdbRes.json();
    if (omdbData?.Title) {
      query = omdbData.Title;
      console.log(`🎬 IMDb → naslov: ${query}`);
    }
  }

  console.log(`🔍 Iščem podnapise za: ${query}`);

  try {
    const searchUrl = `https://www.podnapisi.net/en/subtitles/search/?keywords=${encodeURIComponent(query)}&language=${lang}`;
    const response = await fetch(searchUrl);
    const html = await response.text();

    // Poišči prvo povezavo za prenos
    const match = html.match(/\/en\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g);
    if (!match || !match[0]) {
      console.log("⚠️  Ni bilo najdenih povezav v HTML-ju.");
      return res.json({ subtitles: [] });
    }

    const downloadLink = "https://www.podnapisi.net" + match[0];
    console.log(`✅ Najden prenos: ${downloadLink}`);

    const zipPath = path.join(TMP_DIR, `${query}.zip`);
    const zipRes = await fetch(downloadLink);
    const buf = Buffer.from(await zipRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    // Razpakiraj ZIP
    const zip = new AdmZip(zipPath);
    const extractDir = path.join(TMP_DIR, query);
    zip.extractAllTo(extractDir, true);

    const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️  Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    const srtPath = path.join(extractDir, srtFile);
    console.log(`📜 Najden SRT: ${srtFile}`);

    const stream = [
      {
        id: "formio-podnapisi",
        url: `file://${srtPath}`,
        lang: "sl",
        name: "Formio Podnapisi.NET",
      },
    ];

    res.json({ subtitles: stream });
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err);
    res.json({ subtitles: [] });
  }
});

// Manifest route
app.get("/manifest.json", (req, res) => res.json(manifest));

// Zaženi strežnik
const PORT = process.env.PORT || 7760;
app.listen(PORT, () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
