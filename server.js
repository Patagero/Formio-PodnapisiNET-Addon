import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
// ODSTRANJENA sta chromium in puppeteer-core
import AdmZip from "adm-zip"; 

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "10.0.0", // Jubilejna verzija za "neverjetno vztrajnost"
  name: "Formio Podnapisi.NET 🇸🇮 (Direktni Backend Klic)",
  description: "Išče slovenske podnapise z direktnim HTTP klicem na iskalni backend.",
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

// --- POMOŽNE FUNKCIJE ---

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
 * Neposredni klic na iskalni endpoint Podnapisi.NET.
 */
async function fetchSubtitlesDirect(title) {
    // Iskalni URL na zadnji del, ki morda deluje
    const searchUrl = `https://www.podnapisi.net/sl/search`;
    console.log(`🌍 Poskušam direktni HTTP klic na: ${searchUrl}`);

    try {
        const res = await fetch(searchUrl, {
            method: 'POST', // Pogosto je AJAX iskanje POST
            headers: {
                // Posnemanje brskalnika, da ne sproži zaščite
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'X-Requested-With': 'XMLHttpRequest', // Pove, da je to AJAX klic
            },
            body: `q=${encodeURIComponent(title)}`
        });

        const html = await res.text();
        
        // 1. Preverjanje, ali je rezultat prazen (zelo pogosto)
        if (html.length < 100) {
             console.log("⚠️ Direktni klic vrnil premalo vsebine, parsanje prekinjeno.");
             return [];
        }

        // 2. Parsanje tabele iz HTML-ja, ki ga vrne AJAX
        const results = [];
        
        // Regex za iskanje vrstic v tabeli. Iščemo link na podnapise in jezik.
        const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
        let rowMatch;
        
        // Regex za ekstrakcijo podatkov iz vsake vrstice
        const dataRegex = /href="(\/subtitles\/[^/]+\/download)"[^>]*>[\s\S]*?<span[^>]*rel="(\w{2})"[^>]*>[\s\S]*?<a[^>]*href="\/subtitles\/[^>]*>([\s\S]*?)<\/a>/;

        while ((rowMatch = rowRegex.exec(html)) !== null) {
            const rowContent = rowMatch[1];
            const dataMatch = rowContent.match(dataRegex);

            if (dataMatch) {
                const linkSuffix = dataMatch[1]; // /subtitles/naslov/download
                const lang = dataMatch[2];       // sl, en, hr, ...
                const title = dataMatch[3].replace(/<[^>]*>/g, '').trim(); // Očiščen naslov

                if (lang === 'sl') { // Takoj filtriraj slovenske
                    results.push({
                        link: "https://www.podnapisi.net" + linkSuffix,
                        title: title,
                        lang: lang
                    });
                }
            }
        }
        
        console.log(`✅ Direktni klic uspešen. Slovenski podnapisi najdeni: ${results.length}`);
        return results;

    } catch (error) {
        console.error("❌ Napaka pri direktnem HTTP klicu:", error.message);
        return [];
    }
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
  
  // Iskanje z direktnim fetch klicem
  const slResults = await fetchSubtitlesDirect(title);
  
  // 3. 🧠 FILTER (ostane robusten)
  
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V10.0.0)");
  console.log("🔥 ULTIMATIVNI POSKUS: Direktni backend HTTP klic.");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});