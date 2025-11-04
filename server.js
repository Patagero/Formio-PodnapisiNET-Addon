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
  version: "8.1.0", // Posodobljena verzija
  name: "Formio Podnapisi.NET 🇸🇮 (Robustno Iskanje)",
  description: "Išče slovenske podnapise z razširjenim filtrom in podrobnim logom",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- KONSTANTE ---
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero"; // POZOR: To ni varna praksa za produkcijo!
const PASSWORD = "Formio1978"; 

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const langMap = { sl: "🇸🇮" };

// --- CACHE FUNKCIJE ---
function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// --- PUPPETEER/CHROMIUM ---
let globalBrowser = null;
let globalCookiesLoaded = false;

async function getBrowser() {
  if (globalBrowser) return globalBrowser;
  
  const launchOptions = {
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage", "--single-process"],
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    timeout: 60000,
  };

  try {
    console.log("🚀 Zagon brskalnika Chromium...");
    globalBrowser = await puppeteer.launch(launchOptions);
    console.log("✅ Brskalnik uspešno zagnan.");
    return globalBrowser;
  } catch (error) {
    console.error("❌ Napaka pri zagonu brskalnika:", error.message);
    if (globalBrowser) await globalBrowser.close();
    globalBrowser = null;
    throw new Error("Napaka pri zagonu Puppeteerja. (Morda RAM/CPU omejitev)");
  }
}

async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");
  if (fs.existsSync(cookiesPath) && globalCookiesLoaded) {
    try {
        const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
        await page.setCookie(...cookies);
        console.log("🍪 Uporabljeni obstoječi piškotki (preskočen login).");
        return;
    } catch (e) {
        console.warn("⚠️ Napaka pri nalaganju piškotkov, poskus prijave.");
    }
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  // Uporaba 'domcontentloaded' je hitrejša in pogosto zadostuje
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 90000 }); 

  try {
    await page.waitForSelector("input[name='username']", { timeout: 30000 });
    await page.type("input[name='username']", USERNAME, { delay: 50 });
    await page.type("input[name='password']", PASSWORD, { delay: 50 });

    const loginBtn = await page.waitForSelector("form button[type='submit'], form input[type='submit']", { timeout: 10000 });
    
    // Čaka na uspešno navigacijo po kliku
    const [response] = await Promise.all([
        page.waitForNavigation({ waitUntil: "networkidle0", timeout: 60000 }),
        loginBtn.click(),
    ]);

    const finalUrl = response ? response.url() : await page.url();
    if (finalUrl.includes("myprofile") || finalUrl === "https://www.podnapisi.net/sl/") {
        console.log("✅ Prijava uspešna in potrjena z navigacijo.");
    } else {
        console.log("⚠️ Prijava ni potrjena z URL-jem. Preverjanje vsebine...");
        const pageContent = await page.content();
        if (pageContent.includes("Odjava") || pageContent.includes("Moj profil")) {
             console.log("✅ Prijava uspešna (potrjeno z vsebino strani).");
        } else {
             console.log("❌ Prijava ni potrjena. (Morda CAPTCHA ali napačna kredenciala)");
        }
    }
  } catch (e) {
    console.error("❌ Napaka med procesom prijave:", e.message);
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
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

async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  // Uporabi "domcontentloaded" za hitrejše nalaganje
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });

  let results = [];
  try {
    // Manj specifični selektorji za večjo zanesljivost
    results = await page.$$eval("table.table tbody tr", (rows) =>
      rows.map((row) => {
        const linkElement = row.querySelector("a[href*='/download']");
        const titleElement = linkElement || row.querySelector("a[href*='/subtitles/']");
        
        const link = linkElement ? "https://www.podnapisi.net" + linkElement.getAttribute('href') : null;
        const title = titleElement?.innerText?.trim() || "Neznan";
        
        return link ? { link, title } : null;
      }).filter(Boolean)
    );
  } catch (e) {
    console.warn(`⚠️ Napaka pri evaluaciji: ${e.message}. Poskus z regexom.`);
    const html = await page.content();
    const regex = /href="(\/subtitles\/[^\/]+\/download)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const link = "https://www.podnapisi.net" + match[1];
      const title = match[2].trim();
      results.push({ link, title });
    }
  }
  
  await page.close(); // ZELO POMEMBNO: Zapri stran za prihranek RAM-a

  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  return results.map((r, i) => ({ ...r, lang: langCode, index: i + 1 }));
}

// --- GLAVNI HANDLER ZA PODNAPIS ---
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
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
  
  const slResults = await fetchSubtitlesForLang(browser, title, "sl");

  // 3. 🧠 IZBOLJŠAN IN TOLERANTEN FILTER
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").trim();
  const cleanYear = (year || "").replace(/\D+/g, "");

  // Razdeli naslov na ključne besede (izloči kratke besede za večjo toleranco)
  const titleKeywords = cleanTitle.split(/\s+/).filter(w => w.length > 2); 

  const filteredResults = slResults.filter(r => {
    const t = r.title.toLowerCase();
    
    // 1. Preverjanje ujemanja ključnih besed (VSE morajo biti prisotne)
    const keywordsMatch = titleKeywords.every(keyword => t.includes(keyword));
    
    // 2. Preverjanje ujemanja letnice (zelo pomembno, če je letnica znana)
    const yearOk = cleanYear ? t.includes(cleanYear) : true;
    
    // 3. Izločanje napačnih tipov/formatov
    const isWrongFormat = 
        (type === 'movie' && /(s\d+e\d+|season|episode)/.test(t) && !t.includes(cleanYear)) || // Film, ki izgleda kot serija in ima napačno letnico
        (type === 'series' && !/(s\d+e\d+|season)/.test(t)); // Serija, ki ne vsebuje S/E oznake

    const isFalsePositive = t.includes("anime") || t.includes("documentary"); // Previdnost
    
    // LOGIRANJE IZLOČITEV
    if (!keywordsMatch) console.log(`🚫 Izločen (manjka ključna beseda): ${r.title}`);
    if (cleanYear && !yearOk) console.log(`🚫 Izločen (napačna letnica ${cleanYear}): ${r.title}`);
    if (isWrongFormat) console.log(`🚫 Izločen (napačen format film/serija): ${r.title}`);
    if (isFalsePositive) console.log(`🚫 Izločen (lažen pozitiv - tip v naslovu): ${r.title}`);

    return keywordsMatch && yearOk && !isWrongFormat && !isFalsePositive;
  });

  console.log(`🧩 Po filtriranju ostane ${filteredResults.length} 🇸🇮 relevantnih podnapisov.`);

  if (!filteredResults.length) {
    console.log(`❌ Ni bilo najdenih slovenskih podnapisov za ${title}`);
    // Shranimo prazen rezultat v cache za en dan
    cache[imdbId] = { timestamp: Date.now(), data: [] };
    saveCache(cache);
    return res.json({ subtitles: [] });
  }
  
  // 4. PRENOS IN EKSTRAKCIJA
  const subtitles = [];
  let idx = 1;

  // Dinamičen HOST URL - ZELO POMEMBNO ZA RENDER/HEROKU itd.
  const host = req.protocol + "://" + req.get("host");

  for (const r of filteredResults) {
    const downloadLink = r.link;
    // Ustvari edinstven ID za začasno mapo
    const uniqueId = `${imdbId}_${idx}`;
    const zipPath = path.join(TMP_DIR, `${uniqueId}.zip`);
    const extractDir = path.join(TMP_DIR, uniqueId);
    const flag = langMap[r.lang] || "🌐";

    try {
      const zipRes = await fetch(downloadLink);
      if (!zipRes.ok) throw new Error(`Status ${zipRes.status}`);

      const buf = Buffer.from(await zipRes.arrayBuffer());
      fs.writeFileSync(zipPath, buf);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
      if (srtFile) {
        subtitles.push({
          id: `formio-podnapisi-${idx}`,
          // Uporaba dinamičnega URL-ja
          url: `${host}/files/${uniqueId}/${encodeURIComponent(srtFile)}`, 
          lang: r.lang,
          name: `${flag} ${r.title}`
        });
        console.log(`📜 [${r.lang}] ${srtFile}`);
        idx++;
      }
      
      // Očisti zip datoteko po ekstrakciji
      fs.unlinkSync(zipPath);

    } catch (err) {
      console.log(`⚠️ Napaka pri prenosu #${idx}:`, err.message);
      // Poskusi počistiti mapo, tudi če je prišlo do napake
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    }
  }

  // 5. SHRANJEVANJE IN ODGOVOR
  cache[imdbId] = { timestamp: Date.now(), data: subtitles };
  saveCache(cache);
  res.json({ subtitles });
});

// --- STATIČNI FILE HANDLER ---
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  
  if (fs.existsSync(filePath)) {
    // Pravilna nastavitev Content-Type za SRT
    res.setHeader('Content-Type', 'text/srt; charset=utf-8');
    res.sendFile(filePath);
  }
  else {
    console.log(`❌ Datoteka ni najdena na poti: ${filePath}`);
    res.status(404).send("Subtitle not found");
  }
});

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.1.0)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});