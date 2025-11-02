import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer-core";
import AdmZip from "adm-zip";
import { execSync } from "child_process";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "1.0.7",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

/** 🔧 Poskusi pridobiti ali namestiti Chromium */
async function ensureChromium() {
  const chromiumPath = "/tmp/chromium/chrome-linux64/chrome";
  if (fs.existsSync(chromiumPath)) {
    console.log("✅ Chromium že obstaja:", chromiumPath);
    return chromiumPath;
  }

  console.log("📦 Chromium manjka — prenašam mini verzijo ...");

  // Prenesi uradni Chromium build (~45MB)
  const url =
    "https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/1192060/chrome-linux64.zip";
  const zipPath = "/tmp/chromium.zip";
  const res = await fetch(url);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(zipPath, buf);

  // Razpakiraj
  execSync(`unzip -q ${zipPath} -d /tmp/chromium`);
  fs.rmSync(zipPath);

  console.log("✅ Chromium uspešno nameščen v /tmp/chromium");
  return chromiumPath;
}

/** 🔍 Glavna pot */
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id.replace("tt", "");
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", req.params.id);

  try {
    const executablePath = await ensureChromium();
    console.log("🧩 Uporabljam Chromium:", executablePath);

    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage();
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
      imdbId
    )}&language=sl`;
    console.log("🌍 Iščem z Puppeteer:", searchUrl);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("table tr a[href*='/download']", { timeout: 30000 });

    const downloadLink = await page.$eval("table tr a[href*='/download']", el => el.href);
    console.log("✅ Najden prenos:", downloadLink);
    await browser.close();

    // 📦 Prenesi ZIP podnapisov
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

    console.log("📜 Najden SRT:", srtFile);

    // 🔁 JSON odgovor za Stremio
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

/** 📂 Pošiljanje datotek */
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath, { root: process.cwd() });
  } else {
    res.status(404).send("Subtitle not found");
  }
});

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
