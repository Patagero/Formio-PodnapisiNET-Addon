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
  version: "1.4.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih in angleških podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 🎬 IMDb → naslov filma
async function getTitleFromIMDb(imdbId) {
  const apiKey = "thewdb";
  const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → naslov: ${data.Title}`);
      return data.Title;
    }
  } catch (err) {
    console.log("⚠️ IMDb API napaka:", err.message);
  }
  return imdbId;
}

// 🔧 Puppeteer browser
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

// 🔍 Glavna pot
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);

  async function searchSubtitles(language) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    // Nastavi jezikovni filter (GLF)
    await page.setCookie({
      name: "glf",
      value: language,
      domain: ".podnapisi.net",
      path: "/"
    });

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=${language}`;
    console.log(`🌍 Iščem (${language}): ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 120000 });
    await new Promise(r => setTimeout(r, 15000)); // dodatni čas za nalaganje

    let downloadLink = null;

    // Poskusimo več selektorjev
    const selectors = [
      "a[href*='/download']",
      ".downloads a",
      "table a[href*='/download']",
      "a.btn[href*='/download']"
    ];

    for (const sel of selectors) {
      try {
        const found = await page.$eval(sel, el => el.href);
        if (found) {
          downloadLink = found;
          console.log(`✅ Najden prenos (${sel}): ${found}`);
          break;
        }
      } catch {}
    }

    // Če še vedno ni, uporabimo regex
    if (!downloadLink) {
      console.log("⚠️ Selector ni našel povezave, preklapljam na regex iskanje...");
      const html = await page.content();
      const match = html.match(/\/[a-z]{2}\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g);
      if (match && match.length > 0) {
        downloadLink = "https://www.podnapisi.net" + match[0];
        console.log("✅ Najden prenos (regex):", downloadLink);
      }
    }

    await browser.close();
    return downloadLink;
  }

  let downloadLink = await searchSubtitles("sl");
  if (!downloadLink) {
    console.log("⚠️ Ni slovenskih podnapisov, iščem angleške...");
    downloadLink = await searchSubtitles("en");
  }

  if (!downloadLink) {
    console.log("❌ Ni bilo mogoče najti nobene povezave za prenos.");
    return res.json({ subtitles: [] });
  }

  try {
    // 📦 Prenesi ZIP
    const zipPath = path.join(TMP_DIR, `${imdbId}.zip`);
    const zipRes = await fetch(downloadLink);
    const buf = Buffer.from(await zipRes.arrayBuffer());
    fs.writeFileSync(zipPath, buf);

    // 📂 Razpakiraj ZIP
    const extractDir = path.join(TMP_DIR, imdbId);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️ Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    console.log("📜 Najden SRT:", srtFile);

    const stream = [
      {
        id: "formio-podnapisi",
        url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}/${encodeURIComponent(srtFile)}`,
        lang: "sl",
        name: "Formio Podnapisi.NET 🇸🇮"
      }
    ];

    res.json({ subtitles: stream });
  } catch (err) {
    console.error("❌ Napaka:", err.message);
    res.json({ subtitles: [] });
  }
});

// 📂 Dostop do datotek
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
