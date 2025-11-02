import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

const LOGIN = {
  username: "patagero",
  password: "Formio1978",
};

const TMP_DIR = path.join(process.env.TEMP || "./tmp", "formio_podnapisi");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.3",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"],
};

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  let { id } = req.params;
  let query = id;

  try {
    // Če ID izgleda kot IMDb ID, poberi naslov iz OMDb
    if (id.startsWith("tt")) {
      const omdbRes = await fetch(`https://www.omdbapi.com/?i=${id}&apikey=thewdb`);
      const omdbData = await omdbRes.json();
      if (omdbData?.Title) {
        query = omdbData.Title;
        console.log(`🎬 IMDb → naslov: ${query}`);
      }
    }

    console.log("🔐 Prijava na Podnapisi.net ...");
    const loginRes = await fetch("https://www.podnapisi.net/sl/login", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `username=${LOGIN.username}&password=${LOGIN.password}`,
      redirect: "manual",
    });

    const cookies = loginRes.headers.get("set-cookie") || "";
    console.log(`🍪 Prijava uspešna: ${cookies.includes("PHPSESSID")}`);

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(query)}&movie_type=`;
    console.log(`🔍 Iščem: ${searchUrl}`);

    const response = await fetch(searchUrl, { headers: { Cookie: cookies } });
    const html = await response.text();

    const match = html.match(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g);
    if (!match || !match[0]) {
      console.log("⚠️  Ni bilo najdenih povezav v HTML-ju.");
      return res.json({ subtitles: [] });
    }

    const downloadLink = "https://www.podnapisi.net" + match[0];
    console.log(`✅ Najden prenos: ${downloadLink}`);

    const zipPath = path.join(TMP_DIR, `${query}.zip`);
    const zipRes = await fetch(downloadLink, { headers: { Cookie: cookies } });
    const buf = Buffer.from(await zipRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    const zip = new AdmZip(zipPath);
    const extractDir = path.join(TMP_DIR, query);
    zip.extractAllTo(extractDir, true);

    const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️  Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    const srtPath = path.join(extractDir, srtFile);
    console.log(`📜 Najden SRT: ${srtFile}`);

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

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 7760;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
