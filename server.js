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
  version: "7.1.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Išče slovenske podnapise s prijavo, cache sistemom in varnostnim popravilom.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// 🧠 Varnostno nalaganje in shranjevanje cache-a
function loadCache() {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      console.log("📁 Cache ne obstaja — ustvarjam nov...");
      fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));
      return {};
    }

    const data = fs.readFileSync(CACHE_FILE, "utf8");
    if (!data.trim()) {
      console.log("⚠️ Cache prazen — ustvarjam nov...");
      fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));
      return {};
    }

    return JSON.parse(data);
  } catch (err) {
    console.log("⚠️ Poškodovan cache — ponastavljam:", err.message);
    fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));
    return {};
  }
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.log("⚠️ Napaka pri shranjevanju cache-a:", err.message);
  }
}

let globalBrowser = null;
let globalCookiesLoaded = false;

async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  const executablePath = await chromium.executablePath();
  globalBrowser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
    headless: chromium.headless
  });
  return globalBrowser;
}

async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");
  if (fs.existsSync(cookiesPath) && globalCookiesLoaded) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Uporabljeni obstoječi piškotki (preskočen login).");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000));

  const bodyText = await page.evaluate(() => document.body.innerText);
  if (bodyText.includes("Odjava") || bodyText.includes("Moj profil")) {
    console.log("✅ Uporabnik že prijavljen.");
    globalCookiesLoaded = true;
    return;
  }

  try {
    await page.waitForSelector("input[name='username']", { timeout: 30000 });
  } catch {
    throw new Error("⚠️ Polje za uporabniško ime se ni pojavilo – morda CAPTCHA.");
  }

  await page.type("input[name='username']", USERNAME, { delay: 25 });
  await page.type("input[name='password']", PASSWORD, { delay: 25 });

  const loginBtn = (await page.$("form[action*='login'] button")) ||
                   (await page.$("form[action*='login'] input[type='submit']"));
  if (!loginBtn) throw new Error("⚠️ Gumb za prijavo ni bil najden.");
  await loginBtn.click();

  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 30000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch {
    console.log("⚠️ Prijava ni potrjena (morda počasno nalaganje).");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  globalCookiesLoaded = true;
  console.log("💾 Piškotki shranjeni.");
}

// 🎬 IMDb → naslov (brez letnice)
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return data.Title.trim();
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// 🔎 Iskanje slovenskih podnapisov
async function fetchSubtitles(browser, title) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  console.log(`🌍 Iščem 🇸🇮: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  const html = await page.content();
  const results = [];
  const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const link = "https://www.podnapisi.net" + match[1];
    const name = match[2].trim();
    results.push({ link, name });
  }

  console.log(`✅ Najdenih ${results.length} 🇸🇮 podnapisov.`);
  return results;
}

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  const title = await getTitleFromIMDb(imdbId);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const results = await fetchSubtitles(browser, title);
  if (!results.length) {
    console.log(`❌ Ni bilo najdenih slovenskih podnapisov za ${title}`);
    return res.json({ subtitles: [] });
  }

  const subtitles = [];
  let idx = 1;
  for (const r of results) {
    try {
      const zipRes = await fetch(r.link);
      const buf = Buffer.from(await zipRes.arrayBuffer());
      const zipPath = path.join(TMP_DIR, `${imdbId}_${idx}.zip`);
      const extractDir = path.join(TMP_DIR, `${imdbId}_${idx}`);
      fs.writeFileSync(zipPath, buf);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);
      const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
      if (srtFile) {
        subtitles.push({
          id: `formio-podnapisi-${idx}`,
          url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${idx}/${encodeURIComponent(srtFile)}`,
          lang: "sl",
          name: `🇸🇮 ${r.name}`
        });
        console.log(`📜 Najden SRT: ${srtFile}`);
        idx++;
      }
    } catch (err) {
      console.log(`⚠️ Napaka pri prenosu #${idx}:`, err.message);
    }
  }

  cache[imdbId] = { timestamp: Date.now(), data: subtitles };
  saveCache(cache);
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 aktiven (varen cache + prijava + regex iskanje)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
