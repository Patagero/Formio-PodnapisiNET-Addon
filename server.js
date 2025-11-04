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
  version: "9.1.0", // Posodobljena verzija
  name: "Formio Podnapisi.NET 🇸🇮 (Ultra-Tolerant Parse)",
  description: "Iskanje brez prijave, najde vse podnapise z najbolj tolerantnim parsanjem HTML.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- KONSTANTE ---
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const langMap = { sl: "🇸🇮", en: "🇬🇧", hr: "🇭🇷" };

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

async function getTitleAndYear(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year}) [Tip: ${data.Type}]`);
      return { 
          title: data.Title.trim(), 
          year: data.Year || "", 
          type: data.Type || "movie",
      };
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return { title: imdbId, year: "", type: "movie" };
}

/**
 * Globalno iskanje vseh podnapisov brez omejitve na jezik in ultra-tolerantno parsanje.
 */
async function fetchSubtitlesForAllLangs(browser, title) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}`;
  console.log(`🌍 Iščem globalno (vsi jeziki): ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  
  try {
     await page.waitForSelector("table.table tbody tr", { timeout: 15000 });
     console.log("✅ Iskalna tabela najdena. Parsam rezultate z ultra-toleranco...");
  } catch (e) {
     console.log("⚠️ Iskalna tabela podnapisov ni bila najdena v 15 sekundah (blokada/prazno).");
     await page.close();
     return [];
  }

  let results = [];
  try {
    results = await page.$$eval("table", (tables) => {
        // Združi vse vrstice iz vseh tabel na strani
        const rows = tables.flatMap(table => Array.from(table.querySelectorAll("tbody tr")));
        
        return rows.map((row) => {
            // 1. Link za prenos (najbolj zanesljiv element)
            const downloadLink = row.querySelector("a[href*='/download']");
            
            // 2. Naslov (iščemo v kateremkoli linku v prvi celici)
            const titleElement = row.querySelector("td:nth-child(1) a"); 
            
            // 3. Jezik (iščemo v kateremkoli 'span' z rel atributom ali v celici za jezik)
            const langElement = row.querySelector("span[rel], td.language span"); 
            
            const link = downloadLink ? "https://www.podnapisi.net" + downloadLink.getAttribute('href') : null;
            const title = titleElement?.innerText?.trim() || "Neznan";
            
            // Poskus ekstrakcije jezika
            let lang = "unknown";
            if (langElement) {
                // Poskusi iz rel="koda"
                lang = langElement.getAttribute('rel') || "unknown"; 
                // Poskusi iz title atributa, če je tam koda (sl, en, ...)
                if (lang === "unknown" && langElement.title) {
                    lang = langElement.title.toLowerCase().slice(0, 2);
                }
            }
            
            // Samo popolni zadetki gredo naprej
            return link && title !== "Neznan" && lang.length === 2 ? { link, title, lang } : null; 
        }).filter(Boolean);
    });
  } catch (e) {
    console.error(`❌ Kritična napaka pri evalvaciji/parsiranju rezultatov: ${e.message}`);
    await page.close();
    return [];
  }
  
  await page.close(); 

  const slResults = results.filter(r => r.lang === 'sl');
  console.log(`✅ Najdenih skupaj: ${results.length}. Slovenski: ${slResults.length}`);
  return slResults.map((r, i) => ({ ...r, index: i + 1 }));
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

  // 2. PRIDOBITEV INFO IN ISKANJE
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
  
  // Iskanje vseh jezikov in filtriranje na 'sl'
  const slResults = await fetchSubtitlesForAllLangs(browser, title);
  
  // 3. 🧠 ROBUSTNI FILTER
  
  const currentYear = new Date().getFullYear();
  const targetYear = parseInt(year);
  const useYearFilter = targetYear && targetYear <= currentYear;
  
  const cleanYear = useYearFilter ? (year || "").replace(/\D+/g, "") : ""; 
  
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").trim();
  const titleKeywords = cleanTitle.split(/\s+/).filter(w => w.length > 2); 

  const filteredResults = slResults.filter(r => {
    const t = r.title.toLowerCase();
    
    // 1. Ujemanje: Vsaj polovica ključnih besed
    const keywordsMatchCount = titleKeywords.filter(keyword => t.includes(keyword)).length;
    const keywordsMatch = keywordsMatchCount >= Math.ceil(titleKeywords.length / 2) || t.includes(cleanTitle.replace(/\s/g, ''));
    
    // 2. Preverjanje letnice (če ni prihodnja)
    const yearOk = cleanYear ? t.includes(cleanYear) : true;

    // 3. Izločanje serijskih/napačnih formatov
    const isWrongFormat = 
        (type === 'movie' && /(s\d+e\d+|season|episode)/.test(t)) || 
        (type === 'series' && !/(s\d+e\d+|season)/.test(t)); 

    // LOGIRANJE IZLOČITEV
    if (!keywordsMatch) console.log(`🚫 Izločen (klj. besede): ${r.title}`);
    if (useYearFilter && !yearOk) console.log(`🚫 Izločen (napačna letnica ${cleanYear}): ${r.title}`);
    if (isWrongFormat) console.log(`🚫 Izločen (napačen format film/serija): ${r.title}`);

    return keywordsMatch && yearOk && !isWrongFormat; 
  });

  console.log(`🧩 Po filtriranju ostane ${filteredResults.length} 🇸🇮 relevantnih podnapisov.`);

  if (!filteredResults.length) {
    console.log(`❌ Ni bilo najdenih slovenskih podnapisov za ${title}`);
    cache[imdbId] = { timestamp: Date.now(), data: [] };
    saveCache(cache);
    return res.json({ subtitles: [] });
  }
  
  // 4. PRENOS IN EKSTRAKCIJA
  const subtitles = [];
  let idx = 1;

  const host = req.protocol + "://" + req.get("host");

  for (const r of filteredResults) {
    const downloadLink = r.link;
    const uniqueId = `${imdbId}_${idx}`;
    const zipPath = path.join(TMP_DIR, `${uniqueId}.zip`);
    const extractDir = path.join(TMP_DIR, uniqueId);
    const flag = langMap.sl || "🌐";

    try {
      const zipRes = await fetch(downloadLink, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; FormioSubtitles/1.0)'
        }
      });
      if (!zipRes.ok) throw new Error(`Status ${zipRes.status} pri prenosu ZIP`);

      const buf = Buffer.from(await zipRes.arrayBuffer());
      fs.writeFileSync(zipPath, buf);

      const zip = new AdmZip(zipPath);
      zip.extractAllTo(extractDir, true);

      const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
      if (srtFile) {
        subtitles.push({
          id: `formio-podnapisi-${idx}`,
          url: `${host}/files/${uniqueId}/${encodeURIComponent(srtFile)}`, 
          lang: 'sl',
          name: `${flag} ${r.title}`
        });
        console.log(`📜 [sl] ${srtFile}`);
        idx++;
      }
      
      fs.unlinkSync(zipPath); 

    } catch (err) {
      console.log(`⚠️ Napaka pri prenosu/ekstrakciji #${idx}:`, err.message);
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V9.1.0)");
  console.log("🌐 Zadnji poskus s Puppeteerjem in najbolj tolerantnim parsanjem.");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});