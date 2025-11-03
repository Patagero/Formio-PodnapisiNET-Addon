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
  version: "2.2.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Prikaz vseh slovenskih podnapisov iz podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const CACHE = new Map();
const cacheGet = k => CACHE.get(k);
const cacheSet = (k, v) => { CACHE.set(k, v); if (CACHE.size > 40) CACHE.delete([...CACHE.keys()][0]); };

async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → naslov: ${data.Title}`);
      return data.Title;
    }
  } catch (err) {
    console.log("⚠️ Napaka pri IMDb API:", err.message);
  }
  return imdbId;
}

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
  const browser = await getBrowser();
  const page = await browser.newPage();

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);

  try {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
    await page.waitForSelector("a[href*='/download']", { timeout: 7000 });
  } catch (err) {
    console.log("⚠️ Timeout ali ni zadetkov.");
  }

  const html = await page.content();
  const matches = [...html.matchAll(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g)];

  if (!matches.length) {
    console.log("❌ Ni bilo mogoče najti slovenskih podnapisov.");
    await browser.close();
    return res.json({ subtitles: [] });
  }

  console.log(`✅ Najdenih ${matches.length} slovenskih podnapisov.`);

  const subtitles = [];
  let index = 1;
  for (const match of matches) {
    const downloadLink = "https://www.podnapisi.net" + match[0];
    const zipPath = path.join(TMP_DIR, `${imdbId}_${index}.zip`);
    const extractDir = path.join(TMP_DIR, `${imdbId}_${index}`);

    try {
      const zipRes = await fetch(downloadLink);
      const buf = Buffer.from(await zipRes.arrayBuffer());
      fs.writeFileSync(zipPath, buf);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
      if (srtFile) {
        subtitles.push({
          id: `formio-podnapisi-${index}`,
          url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${index}/${encodeURIComponent(srtFile)}`,
          lang: "sl",
          name: `Formio Podnapisi.NET 🇸🇮 #${index}`
        });
        console.log(`📜 Najden SRT [#${index}]: ${srtFile}`);
        index++;
      }
    } catch (err) {
      console.log(`⚠️ Napaka pri obdelavi #${index}:`, err.message);
    }
  }

  await browser.close();

  cacheSet(imdbId, subtitles);
  res.json({ subtitles });
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
  console.log("✅ Formio Podnapisi.NET Addon 🇸🇮 aktiven!");
  console.log("🌍 Išče in prikaže VSE slovenske podnapise za film.");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
