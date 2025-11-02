import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Manifest Stremio addona
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// 📂 Začasna mapa
const TMP_DIR = path.join(process.cwd(), "tmp");
fs.mkdirSync(TMP_DIR, { recursive: true });

// 🎬 Pridobivanje podnapisov
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  const query = id.replace("tt", "");
  const lang = "sl";
  console.log(`🔍 Iščem podnapise za: ${query}`);

  try {
    const searchUrl = `https://www.podnapisi.net/en/subtitles/search/?keywords=${encodeURIComponent(query)}&language=${lang}`;
    const response = await fetch(searchUrl);
    const html = await response.text();

    const match = html.match(/\/en\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g);
    if (!match || !match[0]) return res.json({ subtitles: [] });

    const downloadLink = "https://www.podnapisi.net" + match[0];
    console.log(`✅ Najden prenos: ${downloadLink}`);

    const zipPath = path.join(TMP_DIR, `${query}.zip`);
    const zipRes = await fetch(downloadLink);
    const buf = Buffer.from(await zipRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    const zip = new AdmZip(zipPath);
    const extractDir = path.join(TMP_DIR, query);
    zip.extractAllTo(extractDir, true);

    const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
    if (!srtFile) return res.json({ subtitles: [] });

    const srtPath = path.join(extractDir, srtFile);
    console.log(`📜 Najden SRT: ${srtFile}`);

    const stream = [{
      id: "formio-podnapisi",
      url: `file://${srtPath}`,
      lang: "sl",
      name: "Formio Podnapisi.NET"
    }];

    res.json({ subtitles: stream });
  } catch (err) {
    console.error("❌ Napaka:", err);
    res.json({ subtitles: [] });
  }
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

// 🏠 Home page
app.get("/", (req, res) => {
  res.send("✅ Formio Podnapisi.NET Addon deluje!");
});

// 🚀 Zagon
const PORT = process.env.PORT || 7760;
app.listen(PORT, () => console.log(`✅ Strežnik teče na portu ${PORT}`));
