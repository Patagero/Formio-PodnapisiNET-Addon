import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "9.4.3",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Pravilno čakanje na AJAX rezultate (popravek za The Lost Bus ipd.)",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

let globalBrowser = null;

// 🧠 Zagon Chromium
async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  const executablePath = await chromium.executablePath();
  globalBrowser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
    headless: chromium.headless
  });
  console.log("✅ Chromium zagnan");
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

  // ⏳ Čakamo do 20 sekund, da se rezultati AJAX naložijo
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("a[href*='/download']").length > 0,
      { timeout: 20000 }
    );
    console.log("📄 Rezultati AJAX so naloženi.");
  } catch {
    console.log("⚠️ Timeout pri čakanju na AJAX rezultate.");
  }

  const html = await page.content();
  const results = [];

  // 📋 DOM metoda
  try {
    const domResults = await page.$$eval("a[href*='/download']", els =>
      els
        .filter(a => a.innerText.trim().length > 0)
        .map(a => ({
          link: a.href.startsWith("http")
            ? a.href
            : "https://www.podnapisi.net" + a.getAttribute("href"),
          title: a.innerText.trim()
        }))
    );
    results.push(...domResults);
  } catch {}

  // 📋 Fallback regex metoda
  if (!results.length) {
    const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const link = match[1].startsWith("http")
        ? match[1]
        : "https://www.podnapisi.net" + match[1];
      const titleTxt = match[2].trim();
      if (titleTxt) results.push({ link, title: titleTxt });
    }
  }

  await page.close();
  console.log(`✅ Najdenih ${results.length} 🇸🇮`);
  return results;
}

// 🧩 Glavni API endpoint
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Zahteva za IMDb:", imdbId);

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const results = await fetchSubtitles(browser, title);

  if (!results.length) {
    console.log(`❌ Ni slovenskih podnapisov za ${title}`);
    return res.json({ subtitles: [] });
  }

  const subtitles = results.map((r, i) => ({
    id: `formio-${i + 1}`,
    url: r.link,
    lang: "sl",
    name: `🇸🇮 ${r.title}`
  }));

  console.log(`♻️ Poslani podatki (${subtitles.length}) za ${title}`);
  res.json({ subtitles });
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// ✅ Keep alive
app.get("/", (req, res) => res.send("Formio Podnapisi.NET 🇸🇮 – AJAX popravek deluje ✅"));

// 🚀 Zagon strežnika
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 – AJAX ready verzija (polling 20s)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
  setInterval(() => console.log("💓 Keep-alive ping"), 60000);
});
