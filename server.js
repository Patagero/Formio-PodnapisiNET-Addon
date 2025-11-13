import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import AdmZip from "adm-zip";
import pLimit from "p-limit";

const app = express();
app.use(cors());
app.use(express.json());

const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const langMap = { sl: "🇸🇮" };
const DOWNLOAD_CONCURRENCY = 3;

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
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

  await page.type("input[name='username']", USERNAME, { delay: 25 });
  await page.type("input[name='password']", PASSWORD, { delay: 25 });

  const loginBtn = (await page.$("form[action*='login'] button")) ||
                   (await page.$("form[action*='login'] input[type='submit']"));
  if (loginBtn) await loginBtn.click();

  try {
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 30000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch {
    console.log("⚠️ Prijava ni potrjena (morda CAPTCHA).");
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  globalCookiesLoaded = true;
  console.log("💾 Piškotki shranjeni.");
}

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

async function setupPageFast(page) {
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const t = req.resourceType();
    if (["image", "stylesheet", "font", "media"].includes(t)) req.abort();
    else req.continue();
  });
}

// ✅ POPRAVLJENA različica funkcije fetchSubtitlesForLang
async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  await setupPageFast(page);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  let results = [];
  try {
    await page.waitForSelector(".subtitle-entry", { timeout: 15000 });
  } catch {
    console.log("⚠️ Elementi niso pravočasno naloženi – zajemam HTML ročno.");
  }

  const html = await page.content();

  try {
    results = await page.$$eval(".subtitle-entry", (rows) =>
      rows.map((r) => ({
        link: r.querySelector("a[href*='/download']")?.href || null,
        title: r.querySelector(".release")?.textContent?.trim() || "Neznan",
        lang: langCode
      })).filter((r) => r.link)
    );
  } catch {
    console.log("⚠️ CSS selector parsing failed, fallback HTML parsing ...");
  }

  // 🔁 fallback regex parser, če CSS ne uspe
  if (results.length === 0) {
    const regex = /href="(https:\/\/www\.podnapisi\.net\/sl\/subtitles\/[^"]*\/download)"[^>]*>([^<]+)/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push({ link: match[1], title: match[2].trim(), lang: langCode });
    }
  }

  await page.close();
  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  return results;
}

// Prenos in razpakiranje ZIP ali SRT
async function robustDownloadAndExtract(downloadUrl, imdbId, idx) {
  const zipPath = path.join(TMP_DIR, `${imdbId}_${idx}.zip`);
  const extractDir = path.join(TMP_DIR, `${imdbId}_${idx}`);
  fs.mkdirSync(extractDir, { recursive: true });

  try {
    const res = await fetch(downloadUrl, { redirect: "follow", timeout: 60000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.toString("utf8", 0, 200).includes("00:")) {
      const outPath = path.join(extractDir, `subtitle_${idx}.srt`);
      fs.writeFileSync(outPath, buf);
      return { ok: true, srt: outPath };
    }

    fs.writeFileSync(zipPath, buf);
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(extractDir, true);

    const srtFile = fs.readdirSync(extractDir).find(f => f.endsWith(".srt"));
    if (srtFile) return { ok: true, srt: path.join(extractDir, srtFile) };
    return { ok: false, error: "No SRT in ZIP" };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

const limit = pLimit(DOWNLOAD_CONCURRENCY);

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
  await page.close();

  const slResults = await fetchSubtitlesForLang(browser, title, "sl");
  if (!slResults.length) return res.json({ subtitles: [] });

  const downloads = await Promise.allSettled(
    slResults.slice(0, 20).map((r, i) => limit(() =>
      robustDownloadAndExtract(r.link, imdbId, i + 1).then(out => ({ r, out }))
    ))
  );

  const subtitles = [];
  let idx = 1;
  for (const d of downloads) {
    if (d.status === "fulfilled" && d.value.out.ok) {
      const srt = d.value.out.srt;
      const srtName = path.basename(srt);
      subtitles.push({
        id: `formio-podnapisi-${idx}`,
        url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${idx}/${encodeURIComponent(srtName)}`,
        lang: "sl",
        name: `${langMap.sl} ${d.value.r.title}`
      });
      idx++;
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

app.get("/manifest.json", (req, res) => res.json({
  id: "com.formio.podnapisinet",
  version: "10.2.1",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Iskalnik slovenskih podnapisov (daljši timeout + fallback HTML parsing)",
  types: ["movie"],
  resources: [{ name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }],
  catalogs: [],
  behaviorHints: { configurable: false, configurationRequired: false }
}));

app.get("/health", (_, res) => res.send("✅ OK"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 posluša na portu ${PORT} (razširjen timeout + fallback)`);
  console.log("==================================================");
});
