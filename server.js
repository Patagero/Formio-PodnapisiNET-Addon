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
  version: "2.3.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Prikaz vseh slovenskih podnapisov s podnapisi.net (asinkroni način)",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const CACHE = new Map();

async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → naslov: ${data.Title}`);
      return data.Title;
    }
  } catch (err) {
    console.log("⚠️ Napaka IMDb API:", err.message);
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

  if (CACHE.has(imdbId)) {
    console.log("⚡ Iz cache-a:", imdbId);
    return res.json({ subtitles: CACHE.get(imdbId) });
  }

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);
  const browser = await getBrowser();
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;

  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

  try {
    // počakaj do 10 sekund, da AJAX naloži podnapise
    await page.waitForSelector("table tr a[href*='/download']", { timeout: 10000 });
  } catch {
    console.log("⚠️ Ni še nalaganja rezultatov — čakamo dodatno 10 sekund ...");
    try {
      await page.waitForFunction(
        () => document.querySelectorAll("a[href*='/download']").length > 0,
        { timeout: 10000 }
      );
    } catch {
      console.log("❌ Ni bilo mogoče najti podnapisov po 20 sekundah.");
    }
  }

  const html = await page.content();
  const matches = [...html.matchAll(/\/sl\/subtitles\/[a-z0-9\-]+\/[A-Z0-9]+\/download/g)];
  await browser.close();

  if (!matches.length) {
    console.log("❌ Ni bilo mogoče najti slovenskih podnapisov.");
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

  CACHE.set(imdbId, subtitles);
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
  console.log("🌍 Prikaže VSE slovenske podnapise (počaka na AJAX).");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
