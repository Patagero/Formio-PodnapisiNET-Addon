import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

// 🔧 Manifest za Stremio
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.4",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  background: "https://www.podnapisi.net/images/background.jpg",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// 📦 Začasni direktorij
const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 🧠 Helper funkcija za izbiro Chromiuma (Render, Vercel, lokalno)
function getChromiumPath() {
  const possible = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  ];
  for (const path of possible) {
    if (path && fs.existsSync(path)) return path;
  }
  return null;
}

// 🔍 Glavna pot
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id.replace("tt", "");
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", req.params.id);

  try {
    // 🚀 Zaženemo Puppeteer
    const executablePath = getChromiumPath();
    console.log("🧩 Uporabljam Chromium path:", executablePath || "(vgrajeni Puppeteer)");

    const browser = await puppeteer.launch({
      headless: true,
      executablePath: executablePath || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
      imdbId
    )}&language=sl`;
    console.log("🌍 Iščem z Puppeteer:", searchUrl);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector("table tr a[href*='/download']", { timeout: 15000 });

    // 📥 Poberemo prvi prenos
    const downloadLink = await page.$eval("table tr a[href*='/download']", el => el.href);
    console.log("✅ Najden prenos:", downloadLink);
    await browser.close();

    // 📦 Prenesi ZIP
    const zipPath = path.join(TMP_DIR, `${imdbId}.zip`);
    const zipRes = await fetch(downloadLink);
    const buf = Buffer.from(await zipRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    // 📂 Razpakiraj ZIP
    const extractDir = path.join(TMP_DIR, imdbId);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    // 🔎 Poišči prvo .srt datoteko
    const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️ Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    const srtPath = path.join(extractDir, srtFile);
    console.log("📜 Najden SRT:", srtFile);

    // 🔁 Stremio JSON
    const stream = [
      {
        id: "formio-podnapisi",
        url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}/${encodeURIComponent(
          srtFile
        )}`,
        lang: "sl",
        name: "Formio Podnapisi.NET"
      }
    ];

    res.json({ subtitles: stream });
  } catch (err) {
    console.error("❌ Napaka:", err.message);
    res.json({ subtitles: [] });
  }
});

// 📂 Pošiljanje SRT datotek
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath, { root: process.cwd() });
  } else {
    res.status(404).send("Subtitle not found");
  }
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

// 🚀 Zagon strežnika
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
