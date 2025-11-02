import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

// 📁 Začasna mapa
const TMP_DIR = path.join(process.cwd(), "tmp", "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 📜 Manifest
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.5",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"],
};

// 🧩 Pridobi podnapise
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  let query = id;
  const lang = "sl";

  try {
    // IMDb → naslov
    if (id.startsWith("tt")) {
      const omdbRes = await fetch(`https://www.omdbapi.com/?i=${id}&apikey=thewdb`);
      const omdbData = await omdbRes.json();
      if (omdbData?.Title) query = omdbData.Title;
    }

    console.log(`🔍 Iščem podnapise za: ${query}`);

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(query)}&language=${lang}`;
    const html = await (await fetch(searchUrl)).text();

    // Poišči prvi link za download
    const match = html.match(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g);
    if (!match || !match[0]) {
      console.log("⚠️ Ni bilo najdenih povezav.");
      return res.json({ subtitles: [] });
    }

    const downloadLink = "https://www.podnapisi.net" + match[0];
    console.log(`✅ Najden prenos: ${downloadLink}`);

    const zipPath = path.join(TMP_DIR, `${query}.zip`);
    const zipBuf = Buffer.from(await (await fetch(downloadLink)).arrayBuffer());
    fs.writeFileSync(zipPath, zipBuf);

    // Razpakiraj ZIP
    const extractDir = path.join(TMP_DIR, query);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    // Poišči prvo .srt datoteko
    const srtFile = fs.readdirSync(extractDir).find(f => f.toLowerCase().endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️ Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    const srtPath = path.join(extractDir, srtFile);
    console.log(`📜 Najden SRT: ${srtFile}`);

    // 🔗 HTTP dostopen URL za Stremio
    const fileUrl = `${req.protocol}://${req.get("host")}/files/${encodeURIComponent(query)}/${encodeURIComponent(srtFile)}`;

    res.json({
      subtitles: [
        {
          id: "formio-podnapisi",
          url: fileUrl,
          lang: "sl",
          name: "Formio Podnapisi.NET",
        },
      ],
    });
  } catch (err) {
    console.error("❌ Napaka:", err);
    res.json({ subtitles: [] });
  }
});

// 🗂 Strežnik za serviranje .srt datotek
app.get("/files/:movie/:file", async (req, res) => {
  try {
    const filePath = path.join(TMP_DIR, req.params.movie, req.params.file);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("❌ Subtitle not found");
    }

    const content = fs.readFileSync(filePath, "utf-8");
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(content);
  } catch (err) {
    console.error("❌ Napaka pri pošiljanju datoteke:", err);
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
