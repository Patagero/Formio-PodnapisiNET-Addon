import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import AdmZip from "adm-zip";

// *** VSTAVLJENI PODATKI ZA PRIJAVO ***
const USERNAME = "patagero";
const PASSWORD = "Formio1978";
// **********************************

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "8.0.4", // Regex prioriteta pri iskanju po naslovu
  name: "Formio Podnapisi.NET 🇸🇮 (Regex Napad)",
  description: "Uporablja iskanje po IMDb ID-ju, pri neuspehu preklopi na robusten Regex Fallback.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- KONSTANTE & CACHE ---
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const COOKIES_PATH = path.join(TMP_DIR, "cookies.json");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const langMap = { sl: "🇸🇮" };

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

let globalBrowser = null;
let globalCookiesLoaded = false;

// --- POMOŽNE FUNKCIJE ---

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
  if (fs.existsSync(COOKIES_PATH) && globalCookiesLoaded) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Uporabljeni obstoječi piškotki (preskočen login).");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000)); 

  try {
    const usernameSelector = "input[name*='username']";
    const passwordSelector = "input[name*='password']";
    
    await page.waitForSelector(usernameSelector, { timeout: 30000 });
    await page.type(usernameSelector, USERNAME, { delay: 25 });
    await page.type(passwordSelector, PASSWORD, { delay: 25 });
    
    const loginBtn = await page.$("form[action*='login'] button") || await page.$("form[action*='login'] input[type='submit']");
    if (!loginBtn) throw new Error("Gumb za prijavo ni najden.");
    
    await loginBtn.click();
    
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 30000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch(error) {
    console.log(`⚠️ Prijava ni potrjena: ${error.message} (morda CAPTCHA/blokada).`);
  }

  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  globalCookiesLoaded = true;
  console.log("💾 Piškotki shranjeni.");
}

async function getTitleAndYear(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year}) [Tip: ${data.Type}]`);
      return { title: data.Title.trim(), year: data.Year || "", type: data.Type || "movie" };
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return { title: imdbId, year: "", type: "movie" };
}

async function fetchSubtitlesForLang(browser, title, langCode, imdbId) { 
  const page = await browser.newPage();
  let results = [];
  let successfulParse = false;
  
  // FUNKCIJA ZA PARSIRANJE REZULTATOV (v primeru, da table.$$eval uspe)
  const parseResults = async () => {
    try {
      return await page.$$eval("table.table tbody tr", (rows) =>
        rows.map((row) => {
          const downloadLink = row.querySelector("a[href*='/download']")?.href;
          const titleElement = row.querySelector("td:nth-child(1) a");
          
          const title = titleElement?.innerText?.trim() || "Neznan"; 
          
          // Izkljucno za V8.0.3 popravek:
          if (title === "Neznan") {
             const rowText = row.innerText;
             // Če vrstica vsebuje besedo "Sinners" (za primer tt31193180), ne zavrzemo takoj.
             if (rowText.toLowerCase().includes("sinners")) {
                 return downloadLink ? { link: downloadLink, title: "Naslov NI Neznan (Prisilno)" } : null;
             }
          }
          
          return downloadLink ? { link: downloadLink, title } : null;
        }).filter(Boolean)
      );
    } catch (e) {
      // Ignoriramo napako pri parsiranju s Puppeteerjem.
      return [];
    }
  };

  // 1. **POSKUS A: Iskanje po IMDb ID-ju**
  let searchUrl = `https://www.podnapisi.net/sl/subtitles/search?id=${imdbId}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}) po IMDb ID: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));
  
  results = await parseResults();
  if (results.length > 0 && results.filter(r => r.title !== "Neznan").length > 0) successfulParse = true;

  // 2. **POSKUS B: Če ni rezultatov po ID-ju, išči po naslovu (Regex prioriteta)**
  if (!successfulParse) {
      searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
      console.log(`🌍 Iščem (${langCode}) po NASLOVU (FallBack - Regex): ${searchUrl}`);
      
      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });
      await new Promise(r => setTimeout(r, 2500));
      
      // *** KLJUČNA SPREMEMBA: NE UPORABIMO parseResults(), ampak GREMO DIREKTNO na Regex ***
      const html = await page.content();
      const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
      let match;
      results = []; // Resetiramo rezultate
      while ((match = regex.exec(html)) !== null) {
          const link = "https://www.podnapisi.net" + match[1];
          const rawTitle = match[2].trim();
          
          if (link.includes("download") && rawTitle.length > 3) {
             results.push({ link, title: rawTitle });
          }
      }
      // Če najdemo rezultate, je Fallback uspel.
      if (results.length > 0) successfulParse = true;

  }
  
  await page.close();

  console.log(`✅ Najdenih skupno ${results.length} (${langCode})`);
  return results.map((r, i) => ({ ...r, lang: langCode, index: i + 1 }));
}

// --- GLAVNI HANDLER ZA PODNAPIS ---
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  const host = req.protocol + "://" + req.get("host"); 
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  // 1. CACHE
  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  // 2. PRIDOBITEV INFO IN PRIJAVA
  const { title, year, type } = await getTitleAndYear(imdbId);
  if (!title || title === imdbId) {
       console.log("❌ Napaka: Ne morem pridobiti naslova filma.");
       return res.json({ subtitles: [] });
  }
  
  let browser;
  try {
    browser = await getBrowser();
  } catch (e) {
    return res.status(503).json({ subtitles: [], error: "Brskalnik se ni uspel zagnati." });
  }
  
  const page = await browser.newPage();
  await ensureLoggedIn(page);
  await page.close(); 

  // 3. ISKANJE (Sedaj vključuje IMDb ID)
  const slResults = await fetchSubtitlesForLang(browser, title, "sl", imdbId);

  // 4. 🧠 FILTER (Ostaja robusten)
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").trim();
  const titleKeywords = cleanTitle.split(/\s+/).filter(w => w.length > 2);
  const cleanYear = (year || "").replace(/\D+/g, "");

  const filteredResults = slResults.filter(r => {
    const t = r.title.toLowerCase();
    
    // Če je naslov "Naslov NI Neznan (Prisilno)", se ujema z originalnim naslovom
    if (t.includes("(prisilno)")) return true; 

    // 1. Ujemanje naslova
    const keywordsMatchCount = titleKeywords.filter(keyword => t.includes(keyword)).length;
    const keywordsMatch = keywordsMatchCount >= Math.ceil(titleKeywords.length / 2) || (titleKeywords.length === 1 && t.includes(titleKeywords[0]));

    // 2. Preverjanje Letnice
    const yearOk = cleanYear ? t.includes(cleanYear) : true;

    // 3. Preverjanje tipa
    const isSeriesFormat = /(s\d+e\d+|season|episode)/.test(t);
    const isWrongType = (type === 'movie' && isSeriesFormat) || (type === 'series' && !isSeriesFormat);
    
    if (!keywordsMatch) console.log(`🚫 Izločen (slabo ujemanje naslova): ${r.title}`);
    if (isWrongType) console.log(`🚫 Izločen (napačen tip - Film/Serija): ${r.title}`);

    return keywordsMatch && !isWrongType && yearOk;
  });

  console.log(`🧩 Po filtriranju ostane ${filteredResults.length} 🇸🇮 relevantnih podnapisov.`);
  
  if (!filteredResults.length) {
    console.log(`❌ Ni bilo najdenih slovenskih podnapisov za ${title}`);
    cache[imdbId] = { timestamp: Date.now(), data: [] };
    saveCache(cache);
    return res.json({ subtitles: [] });
  }

  // 5. PRENOS IN EKSTRAKCIJA
  const subtitles = [];
  let idx = 1;

  for (const r of filteredResults) {
    const downloadLink = r.link;
    const uniqueId = `${imdbId}_${idx}`;
    const zipPath = path.join(TMP_DIR, `${uniqueId}.zip`);
    const extractDir = path.join(TMP_DIR, uniqueId);
    const flag = langMap[r.lang] || "🌐";

    try {
      const zipRes = await fetch(downloadLink, { 
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FormioSubtitles/1.0)' }
      });
      if (!zipRes.ok) throw new Error(`Status ${zipRes.status} pri prenosu ZIP`);

      const buf = Buffer.from(await zipRes.arrayBuffer());
      fs.writeFileSync(zipPath, buf);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
      if (srtFile) {
        const finalTitle = r.title.includes("(Prisilno)") ? title : r.title;
          
        subtitles.push({
          id: `formio-podnapisi-${idx}`,
          url: `${host}/files/${uniqueId}/${encodeURIComponent(srtFile)}`, 
          lang: r.lang,
          name: `${flag} ${finalTitle}`
        });
        console.log(`📜 [${r.lang}] ${srtFile}`);
        idx++;
      }
      
      fs.unlinkSync(zipPath);
      fs.rmSync(extractDir, { recursive: true, force: true });
      
    } catch (err) {
      console.log(`⚠️ Napaka pri prenosu/ekstrakciji #${idx}:`, err.message);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }

  // 6. SHRANJEVANJE IN ODGOVOR
  cache[imdbId] = { timestamp: Date.now(), data: subtitles };
  saveCache(cache);
  res.json({ subtitles });
});

// --- STATIČNI FILE HANDLER ---
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) {
     res.setHeader('Content-Type', 'text/srt; charset=utf-8');
     res.sendFile(filePath);
  }
  else res.status(404).send("Subtitle not found");
});

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.0.4)");
  console.log("💥 ZADNJA LINIJA: Regex zdaj prioriteta pri iskanju po naslovu.");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});