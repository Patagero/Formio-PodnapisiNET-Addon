import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core"; 
import AdmZip from "adm-zip";

// *** VSTAVLJENI PODATKI ZA PRIJAVO ***
const PN_USER = 'patagero';
const PN_PASS = 'Formio1978';
// **********************************

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "9.2.1", // Prijavni podatki vstavljeni
  name: "Formio Podnapisi.NET 🇸🇮 (Puppeteer + Login)",
  description: "Uporablja Puppeteer za prijavo in nato iskanje, da pridobi seansko stanje.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- KONSTANTE & CACHE ---
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const COOKIE_FILE = path.join(TMP_DIR, "cookies.json"); 

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const langMap = { sl: "🇸🇮", en: "🇬🇧", hr: "🇭🇷" };

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// --- PUPPETEER/CHROMIUM & LOGIN FUNKCIJE ---
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
    console.log("🚀 Zagon brskalnika Chromium za prijavo...");
    globalBrowser = await puppeteer.launch(launchOptions);
    console.log("✅ Brskalnik uspešno zagnan.");
    return globalBrowser;
  } catch (error) {
    console.error("❌ Napaka pri zagonu brskalnika:", error.message);
    if (globalBrowser) await globalBrowser.close();
    globalBrowser = null;
    throw new Error("Napaka pri zagonu Puppeteerja.");
  }
}

/**
 * Preveri, ali so piškotki veljavni. Če ne, se ponovno prijavi.
 */
async function ensureLoggedIn(browser) {
  if (!PN_USER || !PN_PASS) {
      console.log("🛑 OPOZORILO: Manjkajo PN_USER ali PN_PASS. Prijava onemogočena.");
      return;
  }
  
  // Poskus nalaganja shranjenih piškotkov
  if (fs.existsSync(COOKIE_FILE)) {
      try {
          const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
          const page = await browser.newPage();
          await page.setCookie(...cookies);
          await page.goto('https://www.podnapisi.net/sl/profile', { waitUntil: 'networkidle0' });
          const isLoggedIn = await page.evaluate(() => {
              // Preveri, ali se pojavi gumb 'Odjava' ali ime uporabnika
              return !!document.querySelector('a[href="/sl/logout"]');
          });
          await page.close();

          if (isLoggedIn) {
              console.log("⚡ Uporabnik je že prijavljen s shranjenimi piškotki.");
              return;
          }
          console.log("⚠️ Piškotki so potekli. Potrebna ponovna prijava.");

      } catch (e) {
          console.error("Napaka pri nalaganju piškotkov:", e.message);
      }
  }

  // --- IZVEDBA PRIJAVE ---
  console.log(`🔑 Prijava kot ${PN_USER} poteka...`);
  const loginPage = await browser.newPage();
  
  try {
    await loginPage.goto('https://www.podnapisi.net/sl/login', { waitUntil: 'domcontentloaded' });
    
    // Čakanje, da se naložijo polja
    await loginPage.waitForSelector('form[method="post"]', { timeout: 15000 }); 
    
    await loginPage.type('#user_username', PN_USER);
    await loginPage.type('#user_password', PN_PASS);
    
    // Klik na gumb za prijavo
    await loginPage.click('input[type="submit"][value="Prijava"]'); 
    
    // Čakaj na preusmeritev na profil ali domov (uspešna prijava)
    await loginPage.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 });

    const isLoggedIn = await loginPage.evaluate(() => {
        return !!document.querySelector('a[href="/sl/logout"]');
    });

    if (isLoggedIn) {
        console.log(`✅ Uporabnik ${PN_USER} uspešno prijavljen!`);
        // Shranjevanje novih piškotkov za naslednjič
        const cookies = await loginPage.cookies();
        fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
    } else {
        console.log("❌ Prijava NEUSPEŠNA. Preveri uporabniško ime/geslo ali blokado.");
    }
    
  } catch (error) {
    console.error(`❌ Kritična napaka pri prijavi: ${error.message}`);
  } finally {
    await loginPage.close();
  }
}

// ... (funkcija getTitleAndYear je enaka)

/**
 * Iskanje podnapisov Z UPORABO PRIJAVLJENE SEJE.
 */
async function fetchSubtitlesWithSession(browser, title) {
  const page = await browser.newPage();
  
  // Nalaganje shranjenih piškotkov (ki smo jih dobili pri prijavi)
  if (fs.existsSync(COOKIE_FILE)) {
      const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
      await page.setCookie(...cookies);
  }

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}`;
  console.log(`🌍 Iščem z aktivno sejo: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  
  // Čakanje na tabelo
  try {
     await page.waitForSelector("table.table tbody tr", { timeout: 15000 });
     console.log("✅ Iskalna tabela najdena. Parsam rezultate...");
  } catch (e) {
     console.log("⚠️ Iskalna tabela podnapisov ni bila najdena (morda je strežnik blokiral ali pa ni rezultatov).");
     await page.close();
     return [];
  }

  let results = [];
  try {
    // Ultra-tolerantno parsanje
    results = await page.$$eval("table", (tables) => {
        const rows = tables.flatMap(table => Array.from(table.querySelectorAll("tbody tr")));
        
        return rows.map((row) => {
            const downloadLink = row.querySelector("a[href*='/download']");
            const titleElement = row.querySelector("td:nth-child(1) a"); 
            const langElement = row.querySelector("span[rel], td.language span"); 
            
            const link = downloadLink ? "https://www.podnapisi.net" + downloadLink.getAttribute('href') : null;
            const title = titleElement?.innerText?.trim() || "Neznan";
            
            let lang = "unknown";
            if (langElement) {
                lang = langElement.getAttribute('rel') || langElement.title?.toLowerCase()?.slice(0, 2) || "unknown";
            }
            
            return link && title !== "Neznan" && lang.length === 2 ? { link, title, lang } : null; 
        }).filter(Boolean);
    });
  } catch (e) {
    console.error(`❌ Kritična napaka pri evalvaciji/parsiranju rezultatov: ${e.message}`);
    await page.close();
    return [];
  }
  
  await page.close(); 
  console.log(`✅ Najdenih skupaj: ${results.length}.`);
  return results.map((r, i) => ({ ...r, index: i + 1 }));
}

// --- GLAVNI HANDLER ZA PODNAPIS ---
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  // 1. CACHE (nespremenjeno)
  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  // 2. PRIDOBITEV INFO
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
  
  // ** Izvedba prijave in nalaganje piškotkov **
  await ensureLoggedIn(browser);
  
  // Iskanje z seanso
  const allResults = await fetchSubtitlesWithSession(browser, title);
  
  // 3. 🧠 FILTER
  const slResults = allResults.filter(r => r.lang === 'sl');
  
  // ... (Logika filtriranja, kot v prejšnjih različicah)
  
  const currentYear = new Date().getFullYear();
  const targetYear = parseInt(year);
  const useYearFilter = targetYear && targetYear <= currentYear;
  
  const cleanYear = useYearFilter ? (year || "").replace(/\D+/g, "") : ""; 
  
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").trim();
  const titleKeywords = cleanTitle.split(/\s+/).filter(w => w.length > 2); 

  const finalFilteredResults = slResults.filter(r => {
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

    return keywordsMatch && yearOk && !isWrongFormat; 
  });

  console.log(`🧩 Po filtriranju ostane ${finalFilteredResults.length} 🇸🇮 relevantnih podnapisov.`);

  if (!finalFilteredResults.length) {
    console.log(`❌ Ni bilo najdenih slovenskih podnapisov za ${title}`);
    cache[imdbId] = { timestamp: Date.now(), data: [] };
    saveCache(cache);
    return res.json({ subtitles: [] });
  }
  
  // 4. PRENOS IN EKSTRAKCIJA SLOVENSKIH PODNAPISOV (nespremenjeno)
  // ... (ta del kode je enak)
  const subtitles = [];
  let idx = 1;
  const host = req.protocol + "://" + req.get("host");

  for (const r of finalFilteredResults) {
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V9.2.1)");
  console.log(`🔑 PRIJAVA AKTIVNA: Uporabnik ${PN_USER} poskuša vzpostaviti sejo.`);
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});