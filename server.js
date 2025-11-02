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
  version: "1.2.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 🔎 Pretvori IMDb ID → naslov filma (OMDb API)
async function getTitleFromIMDb(imdbId) {
  const apiKey = "thewdb"; // brezplačen testni ključ
  const url = `https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.Title) {
      console.log(`🎬 IMDb → naslov: ${data.Title}`);
      return data.Title;
    }
  } catch (err) {
    console.log("⚠️ IMDb API ni vrnil naslova:", err.message);
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

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
    console.log("🌍 Iščem z Puppeteer:", searchUrl);

    await page.goto(searchUrl, { waitUntil: "networkidle0", timeout: 90000 });

    // počakaj na rezultate (tabela ali seznam)
    await page.waitForFunction(
      () =>
        document.querySelectorAll("table tr a[href*='/download'], a.download").length > 0,
      { timeout: 12000 }
    );

    const downloadLink = await page.$eval(
      "table tr a[href*='/download'], a.download",
      el => el.href
    );

    console.log("✅ Najden prenos:", downloadLink);
    await browser.close();

    // 📦 Prenos ZIP-a
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
        name: "Formio Podnapisi.NET"
      }
    ];

    res.json({ subtitles: stream });
  } catch (err) {
    console.error("❌ Napaka:", err.message);

    // Shrani HTML za analizo
    const htmlDump = path.join(TMP_DIR, `${imdbId}.html`);
    try {
      const browser = await getBrowser();
      const page = await browser.newPage();
      const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
        imdbId
      )}&language=sl`;
      await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
      fs.writeFileSync(htmlDump, await page.content());
      await browser.close();
      console.log(`📄 Shranil HTML v ${htmlDump}`);
    } catch (dumpErr) {
      console.log("⚠️ Neuspešno shranjevanje HTML:", dumpErr.message);
    }

    res.json({ subtitles: [] });
  }
});

// 📂 Stremio zahteva SRT datoteko
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
