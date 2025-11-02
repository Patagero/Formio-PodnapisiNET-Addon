import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import puppeteer from "puppeteer";

const app = express();
app.use(cors());
app.use(express.json());

// 📂 mapa za začasne datoteke
const STORAGE_DIR = path.join(process.cwd(), "data", "formio_podnapisi");
if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true });

// 📜 Manifest za Stremio
const manifest = {
  id: "org.formio.podnapisi",
  version: "2.0.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov iz podnapisi.net za filme in serije v Stremiu",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  catalogs: [],
  idPrefixes: ["tt"]
};

// 🎬 IMDb ID → naslov
async function getTitleFromIMDB(imdbID) {
  try {
    const r = await fetch(`https://www.omdbapi.com/?i=${imdbID}&apikey=thewdb`);
    const d = await r.json();
    return d?.Title || imdbID;
  } catch {
    return imdbID;
  }
}

// 🔍 Išči podnapise z uporabo Puppeteer
async function searchPodnapisi(title, lang = "sl") {
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${lang}`;
  console.log(`🌍 Iščem z Puppeteer: ${searchUrl}`);

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

  // počakaj na tabelo rezultatov (če obstaja)
  await page.waitForSelector(".table", { timeout: 15000 }).catch(() => {});

  const links = await page.$$eval("a[href*='/sl/subtitles/']", as =>
    as.map(a => a.getAttribute("href")).filter(h => h.includes("/download"))
  );

  await browser.close();

  console.log(`🔗 Najdenih povezav: ${links.length}`);
  return links;
}

// 🧩 Glavni Stremio route
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
