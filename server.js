import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
// Odstranjena sta chromium in puppeteer-core, ker ne delujeta
import AdmZip from "adm-zip"; 

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "8.4.0", // Posodobljena verzija
  name: "Formio Podnapisi.NET 🇸🇮 (Google Search)",
  description: "Išče slovenske podnapise preko Google iskalnika za obvod blokade in filtrira po nazivu.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- KONSTANTE ---
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
// Odstranjena prijavna logika
// const LOGIN_URL = "https://www.podnapisi.net/sl/login"; 
// const USERNAME = "patagero"; 
// const PASSWORD = "Formio1978"; 

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

// --- POMOŽNE FUNKCIJE ---

async function getTitleAndYear(imdbId) {
  try {
    // API Key 'thewdb' je neveljaven za resno uporabo. Tukaj sem ga pustil, ampak
    // za produkcijo priporočam pridobitev lastnega OMDB API ključa.
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year}) [Tip: ${data.Type}]`);
      return { 
          title: data.Title.trim(), 
          year: data.Year || "", 
          type: data.Type || "movie",
          plot: data.Plot || "" // Za morebitno poznejšo uporabo v filtru
      };
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return { title: imdbId, year: "", type: "movie", plot: "" };
}

/**
 * Iskanje podnapisov s pomočjo Google iskalnika (site:podnapisi.net).
 * @returns Array of { link: string, title: string }
 */
async function fetchSubtitlesViaGoogle(title, year) {
    const searchKeywords = `site:podnapisi.net/sl/podnapisi/ ${title} ${year || ""}`;
    // Uporaba google.com/search in iskanje po elementih 'a[href]'
    const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchKeywords)}`;
    console.log(`🌍 Iščem preko Googla: ${googleSearchUrl}`);

    try {
        const res = await fetch(googleSearchUrl, {
            // Predstavljamo se kot standardni brskalnik, da ne dobimo CAPTCHA ali blokade
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        const html = await res.text();
        
        // Regex za iskanje URL-jev, ki se ujemajo z vzorcem Podnapisi.NET v Googlovih rezultatih.
        // Iščemo linke na podnapisi.net/sl/podnapisi/{naslov}
        const regex = /<a href="(\/url\?q=https:\/\/www\.podnapisi\.net\/sl\/podnapisi\/[^&]+)"[^>]*>(.*?)<\/a>/g;
        let match;
        const results = [];

        while ((match = regex.exec(html)) !== null) {
            // match[1] je Googlov preusmeritveni URL, ki ga moramo počistiti
            const googleUrl = match[1];
            // Dekodiramo in dobimo čisti podnapisi.net URL
            const finalUrlMatch = decodeURIComponent(googleUrl).match(/url\?q=(https:\/\/www\.podnapisi\.net\/sl\/podnapisi\/[^\s&]+)/);

            if (finalUrlMatch) {
                const podnapisiUrl = finalUrlMatch[1];
                // Naslov iz Googlovih rezultatov (match[2])
                const titleMatch = match[2].replace(/<[^>]*>/g, '').trim(); 
                
                // Pretvorimo URL s podrobnostmi v URL za prenos (download)
                // Ker gre za URL-je s podrobnostmi: https://www.podnapisi.net/sl/podnapisi/naslov-podnapisa
                // Dodamo '/download' na konec
                const downloadLink = podnapisiUrl.replace(/\/$/, "") + '/download';
                
                results.push({ 
                    link: downloadLink, 
                    title: titleMatch,
                    url: podnapisiUrl // URL za lažje debuggiranje
                });
            }
        }
        
        console.log(`✅ Najdenih ${results.length} URL-jev preko Googla.`);
        return results;

    } catch (error) {
        console.error("❌ Napaka pri iskanju preko Googla:", error.message);
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
  
  // Iskanje preko Googla!
  const slResults = await fetchSubtitlesViaGoogle(title, year);
  
  // 3. 🧠 FILTER: Manj agresiven, osredotočen na ključne besede
  
  // Bolj tolerantno čiščenje naslova za ključne besede
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").trim();
  const titleKeywords = cleanTitle.split(/\s+/).filter(w => w.length > 2); 

  const filteredResults = slResults.filter(r => {
    const t = r.title.toLowerCase();
    
    // 1. Preverjanje ujemanja ključnih besed (vsaj polovica mora biti prisotna, ali celotno ime)
    const keywordsMatchCount = titleKeywords.filter(keyword => t.includes(keyword)).length;
    const keywordsMatch = keywordsMatchCount >= Math.ceil(titleKeywords.length / 2) || t.includes(cleanTitle.replace(/\s/g, ''));
    
    // 2. Izločanje serijskih/napačnih formatov
    const isWrongFormat = 
        (type === 'movie' && /(s\d+e\d+|season|episode)/.test(t)) || 
        (type === 'series' && !/(s\d+e\d+|season)/.test(t)); 

    // LOGIRANJE IZLOČITEV
    if (!keywordsMatch) console.log(`🚫 Izločen (ne ustreza ključnim besedam): ${r.title}`);
    if (isWrongFormat) console.log(`🚫 Izločen (napačen format film/serija): ${r.title}`);

    return keywordsMatch && !isWrongFormat; 
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
      // Potrebno je dodati User-Agent tudi pri prenosu, sicer Podnapisi.NET lahko blokira
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.4.0)");
  console.log("🌐 Sedaj iščemo preko Google Bypass metode.");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});