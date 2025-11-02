import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

/* 🔧 Nastavitve prijave in API */
const LOGIN = {
  username: "patagero",
  password: "Formio1978",
};
const OMDB_KEY = "thewdb"; // brezplačni ključ za OMDb API
const TMP_DIR = path.join(process.env.TEMP || "./tmp", "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

/* 📦 Manifest za Stremio */
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.2",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"],
};

/* 🔍 Glavna pot za pridobivanje podnapisov */
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  let { id } = req.params;
  const lang = "sl";
  let query = id;
  let year = "";

  try {
    // 🔹 1. IMDb → naslov + leto
    if (id.startsWith("tt")) {
      const omdbUrl = `https://www.omdbapi.com/?i=${id}&apikey=${OMDB_KEY}`;
      const omdbRes = await fetch(omdbUrl);
      const omdbData = await omdbRes.json();
      if (omdbData?.Title) {
        query = omdbData.Title;
        year = omdbData.Year || "";
        console.log(`🎬 IMDb → naslov: ${query} (${year})`);
      }
    }

    // 🔹 2. Prijava na Podnapisi.net
    console.log("🔐 Prijava na Podnapisi.net ...");
    const loginRes = await fetch("https://www.podnapisi.net/en/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${LOGIN.username}&password=${LOGIN.password}`,
      redirect: "manual",
    });

    const cookies = loginRes.headers.get("set-cookie") || "";
    console.log(`🍪 Prijava uspešna: ${cookies.includes("PHPSESSID")}`);

    // 🔹 3. Iskanje podnapisov
    const searchQuery = `${query} ${year}`.trim();
    const searchUrl = `https://www.podnapisi.net/en/subtitles/search/?keywords=${encodeURIComponent(searchQuery)}&language=${lang}`;
    console.log(`🔍 Iščem: ${searchUrl}`);

    const response = await fetch(searchUrl, {
      headers: { Cookie: cookies },
    });
    const html = await response.text();

    // 🔹 4. Poišči povezavo za prenos
    const match = html.match(/\/en\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g);
    if (!match || !match[0]) {
      console.log("⚠️  Ni bilo najdenih povezav v HTML-ju.");
      return res.json({ subtitles: [] });
    }

    const downloadLink = "https://www.podnapisi.net" + match[0];
    console.log(`✅ Najden prenos: ${downloadLink}`);

    // 🔹 5. Prenos ZIP datoteke
    const zipPath = path.join(TMP_DIR, `${query}.zip`);
    const zipRes = await fetch(downloadLink, { headers: { Cookie: cookies } });
    const buf = Buffer.from(await zipRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    // 🔹 6. Razpakiranje ZIP
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

    // 🔹 7. Pošlji JSON Stremiu
    res.json({
      subtitles: [
        {
          id: "formio-podnapisi",
          url: `file://${srtPath}`,
          lang: "sl",
          name: "Formio Podnapisi.NET",
        },
      ],
    });
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err);
    res.json({ subtitles: [] });
  }
});

/* 📜 Manifest route */
app.get("/manifest.json", (req, res) => res.json(manifest));

/* 🚀 Zaženi strežnik */
const PORT = process.env.PORT || 7760;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
