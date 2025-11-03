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
  version: "1.6.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih in angleških podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 🔄 Preprost cache (RAM)
const CACHE = new Map();
const cacheGet = key => CACHE.get(key);
const cacheSet = (key, val) => {
  CACHE.set(key, { val, time: Date.now() });
  if (CACHE.size > 10) CACHE.delete([...CACHE.keys()][0]);
};

// 🎬 IMDb → naslov
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
  } catch {
    return imdbId;
  }
  return imdbId;
}

async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
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
    return res.json({ subtitles: cached.val });
  }

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);

  async function searchSubtitles(language) {
    const browser = await getBrowser();
    const page = await browser.newPage();

    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    );

    const searchUrl = `https://www.podnapisi.net/en/subtitles/search/?keywords=${query}`;
    console.log(`🌍 Iščem (${language}): ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

    // Če iščemo slovenske, klikni filter v levem meniju
    if (language === "sl") {
      try {
        await page.waitForSelector("label[for*='sl']", { timeout: 5000 });
        await page.click("label[for*='sl']");
        await page.waitForTimeout(3000);
        console.log("🇸🇮 Filter 'Slovenščina' aktiviran");
      } catch {
        console.log("⚠️ Ni bilo mogoče klikniti 'Slovenščina'");
      }
    }

    let downloadLink = null;
    const selectors = [
      "a[href*='/download']",
      "table a[href*='/download']",
      ".downloads a"
    ];

    for (const sel of selectors) {
      try {
        const found = await page.$eval(sel, el => el.href);
        if (found) {
          downloadLink = found;
          console.log(`✅ Najden prenos (${language}): ${found}`);
          break;
        }
      } catch {}
    }

    if (!downloadLink) {
      console.log("⚠️ Regex fallback ...");
      const html = await page.content();
      const match = html.match(/\/[a-z]{2}\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/);
      if (match) {
        downloadLink = "https://www.podnapisi.net" + match[0];
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
    console.log("❌ Ni bilo mogoče najti povezave za prenos.");
    return res.json({ subtitles: [] });
  }

  // 📦 Prenesi ZIP in razpakiraj
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

    const result = [
      {
        id: "formio-podnapisi",
        url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}/${encodeURIComponent(srtFile)}`,
        lang: "sl",
        name: "Formio Podnapisi.NET 🇸🇮"
      }
    ];

    cacheSet(imdbId, result);
    console.log("📜 Najden SRT:", srtFile);
    res.json({ subtitles: result });
  } catch (err) {
    console.error("❌ Napaka:", err.message);
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
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
