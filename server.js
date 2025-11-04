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
  version: "9.4.1",
  name: "Formio Podnapisi.NET 🇸🇮",
  description:
    "Hitra iskanja slovenskih podnapisov s podporo lazy-load, cache in dummy rezultatom",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

let globalBrowser = null;

async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  try {
    const executablePath = await chromium.executablePath();
    globalBrowser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
      executablePath,
      headless: chromium.headless
    });
    console.log("✅ Chromium zagnan");
  } catch (e) {
    console.log("⚠️ Puppeteer/Chromium ni bil zagnan:", e.message);
  }
  return globalBrowser;
}

// 🎬 IMDb → naslov
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title}`);
      return data.Title.trim();
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// 🔍 Pridobi slovenske podnapise
async function fetchSubtitles(browser, title) {
  if (!browser) return [];
  const page = await browser.newPage();
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log(`🌍 Iščem 🇸🇮: ${url}`);

  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));

  const html = await page.content();
  const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
  const results = [];
  let match;
  while ((match = regex.exec(html)) !== null) {
    const link = "https://www.podnapisi.net" + match[1];
    const titleTxt = match[2].trim();
    if (titleTxt) results.push({ link, title: titleTxt });
  }
  console.log(`✅ Najdenih ${results.length} 🇸🇮`);
  await page.close();
  return results;
}

// 📜 Pot za podnapise
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Zahteva za IMDb:", imdbId);

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const results = await fetchSubtitles(browser, title);

  if (!results.length) {
    console.log("❌ Ni slovenskih podnapisov.");
    return res.json({ subtitles: [] });
  }

  const subtitles = results.map((r, i) => ({
    id: `formio-${i + 1}`,
    url: r.link,
    lang: "sl",
    name: `🇸🇮 ${r.title}`
  }));

  res.json({ subtitles });
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// ✅ “Keep alive” route
app.get("/", (req, res) => res.send("Formio Podnapisi.NET 🇸🇮 deluje ✅"));

// 🚀 Zagon strežnika
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 – Render stabilna verzija");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
  // ping every 60s, da Render ne misli da je proces mrtev
  setInterval(() => console.log("💓 Keep-alive ping"), 60000);
});
