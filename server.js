import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "2.0.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Iskanje in prenos slovenskih podnapisov s podnapisi.net (brez angleških, hitro delovanje)",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 🔹 Enostaven cache (da se isti film ne išče večkrat)
const CACHE = new Map();
const cacheGet = k => CACHE.get(k);
const cacheSet = (k, v) => { CACHE.set(k, v); if (CACHE.size > 20) CACHE.delete([...CACHE.keys()][0]); };

// 🎬 IMDb → naslov
async function getTitleFromIMDb(imdbId) {
  const apiKey = "thewdb";
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → naslov: ${data.Title}`);
      return data.Title;
    }
  } catch {}
  return imdbId;
}

// 🧩 Puppeteer browser setup
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const cached = cacheGet(imdbId);
  if (cached) {
    console.log("⚡ Iz cache-a:", imdbId);
    return res.json({ subtitles: cached });
  }

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);

  // 🔍 Iskanje SAMO slovenskih podnapisov
  async function searchSlovene() {
    const browser = await getBrowser();
    const page = await browser.newPage();
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}`;
    console.log(`🌍 Iščem (samo slovenske): ${searchUrl}`);

    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    } catch {
      console.log("⚠️ Napaka pri nalaganju strani");
    }

    // Klik filter “Slovenščina” - tudi, če ni viden
    try {
      await page.evaluate(() => {
        const checkbox = document.querySelector("input[id*='sl']");
        if (checkbox && !checkbox.checked) {
          checkbox.checked = true;
          checkbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
      await page.waitForTimeout(1000);
      console.log("🇸🇮 Filter 'Slovenščina' aktiviran (JS)");
    } catch {
      console.log("⚠️ Ni bilo mogoče aktivirati filtra 'Slovenščina'");
    }

    // Poišči povezavo za prenos
    let downloadLink = null;
    try {
      downloadLink = await page.$eval("a[href*='/download']", el => el.href);
      console.log(`✅ Najden prenos: ${downloadLink}`);
    } catch {
      const html = await page.content();
      const match = html.match(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/);
      if (match) {
        downloadLink = "https://www.podnapisi.net" + match[0];
        console.log(`✅ Najden (regex): ${downloadLink}`);
      } else {
        console.log("❌ Ni najdenih slovenskih podnapisov");
      }
    }

    await browser.close();
    return downloadLink;
  }

  const downloadLink = await searchSlovene();
  if (!downloadLink) return res.json({ subtitles: [] });

  // 📦 Prenos ZIP in razpakiranje
  try {
    const zipPath = path.join(TMP_DIR, `${imdbId}.zip`);
    const zipRes = await fetch(downloadLink);
    const buf = Buffer.from(await zipRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    const extractDir = path.join(TMP_DIR, imdbId);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️ Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    const subtitles = [
      {
        id: "formio-podnapisi",
        url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}/${encodeURIComponent(srtFile)}`,
        lang: "sl",
        name: "Formio Podnapisi.NET 🇸🇮"
      }
    ];

    cacheSet(imdbId, subtitles);
    console.log("📜 Najden SRT:", srtFile);
    res.json({ subtitles });
  } catch (err) {
    console.error("❌ Napaka pri razpakiranju:", err.message);
    res.json({ subtitles: [] });
  }
});

app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven! (Samo 🇸🇮)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
