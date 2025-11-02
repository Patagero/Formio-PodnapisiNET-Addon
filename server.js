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
  version: "1.3.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 🎬 IMDb ID → Naslov filma prek OMDb API
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

// 🧩 Puppeteer z Chromium (Render friendly)
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
  });
}

// 🔍 Glavna pot za pridobivanje podnapisov
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
    console.log("🌍 Iščem z Puppeteer:", searchUrl);

    await page.goto(searchUrl, { waitUntil: "networkidle0", timeout: 90000 });

    // počakaj, da se prikažejo rezultati
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          "a[href*='/download'], table tr a[href*='/download'], .downloads a[href*='/download']"
        ).length > 0,
      { timeout: 25000 }
    );

    const downloadLink = await page.$eval(
      "a[href*='/download'], table tr a[href*='/download'], .downloads a[href*='/download']",
      el => el.href
    );

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

    const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
    if (!srtFile) {
      console.log("⚠️ Ni .srt datoteke v ZIP-u.");
      return res.json({ subtitles: [] });
    }

    console.log("📜 Najden SRT:", srtFile);

    const stream = [
      {
        id: "formio-podnapisi",
        url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}/${encodeURIComponent(
          srtFile
        )}`,
        lang: "sl",
        name: "Formio Podnapisi.NET 🇸🇮"
      }
    ];

    res.json({ subtitles: stream });
  } catch (err) {
    console.error("❌ Napaka:", err.message);

    // če Puppeteer ne najde ničesar, shrani HTML za pregled
    const htmlDump = path.join(TMP_DIR, `${imdbId}.html`);
    try {
      fs.writeFileSync(htmlDump, `<p>Napaka: ${err.message}</p>`);
      console.log(`📄 HTML dump shranjen v ${htmlDump}`);
    } catch {}
    res.json({ subtitles: [] });
  }
});

// 📂 Stremio zahteva SRT datoteko
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
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
