import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import AdmZip from "adm-zip"; 

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "13.0.0", // Naš srečni, reverse-engineering poskus!
  name: "Formio Podnapisi.NET 🇸🇮 (Kodi Simulation)",
  description: "Iskanje z najbolj verjetno iskalno potjo in glavami, ki jih uporablja Kodi a4kSubtitles.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- KONSTANTE & CACHE ---
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");

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
 * Globalno iskanje s simulacijo Kodijevega User-Agenta in IMDb ID-ja.
 */
async function fetchSubtitlesKodiSim(imdbId, title) {
    // URL, ki je optimiziran za Kodi dodatke (lahko da je bil to 'skrivni' klic)
    const searchUrl = `https://www.podnapisi.net/subtitles/search/query?imdb=${imdbId}&query=${encodeURIComponent(title)}&language=sl`;
    console.log(`🌍 Poskušam KODI SIMULACIJO: ${searchUrl}`);

    try {
        const res = await fetch(searchUrl, {
            method: 'GET',
            headers: {
                // Posnemanje tipičnega Python/Kodi User-Agenta
                'User-Agent': 'Mozilla/5.0 (Windows; U; Windows NT 5.1; en-GB; rv:1.9.0.3) Gecko/2008092417 Firefox/3.0.3',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive',
            }
        });

        // Verjetno vrne HTML, ki ga je treba parati
        const html = await res.text();
        
        // --- PARSIRANJE HTML-ja z REGEX-om ---
        const results = [];
        
        // Regex prilagojen na to, da ujamemo celo vrstico in poskuša iz nje izvleči 3 ključne informacije:
        // Opomba: Ker smo dodali language=sl, pričakujemo večinoma slovenske podnapise!
        const rowRegex = /href="(\/subtitles\/[^/]+\/download)"[\s\S]*?rel="(\w{2})"[^>]*>[\s\S]*?<a[^>]*href="\/subtitles\/[^>]*>([\s\S]*?)<\/a>/g;
        let match;

        while ((match = rowRegex.exec(html)) !== null) {
            const linkSuffix = match[1]; 
            const lang = match[2];       
            const titleMatch = match[3].replace(/<[^>]*>/g, '').trim(); 

            // Vrnemo VSE, kar je Regex ujel, da vidimo, če dela
            if (titleMatch) { 
                results.push({
                    link: "https://www.podnapisi.net" + linkSuffix,
                    title: titleMatch,
                    lang: lang
                });
            }
        }
        
        console.log(`✅ Kodi simulacija uspešna. Skupaj najdenih (vsi jeziki): ${results.length}`);
        return results;

    } catch (error) {
        console.error("❌ Napaka pri Kodi simulaciji:", error.message);
        return [];
    }
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

  // 2. PRIDOBITEV INFO IN ISKANJE
  const { title, year, type } = await getTitleAndYear(imdbId);
  if (!title || title === imdbId) {
       console.log("❌ Napaka: Ne morem pridobiti naslova filma.");
       return res.json({ subtitles: [] });
  }
  
  // Iskanje s simulacijo Kodija (ključni klic)
  const allResults = await fetchSubtitlesKodiSim(imdbId, title); 
  
  // Če nismo nič našli, se ustavi.
  if (!allResults.length) {
    console.log(`❌ Ni bilo najdenih podnapisov (tudi v drugih jezikih) za ${title}`);
    cache[imdbId] = { timestamp: Date.now(), data: [] };
    saveCache(cache);
    return res.json({ subtitles: [] });
  }
  
  // 3. 🧠 FILTER ZA SLOVENSKE
  // Za nalaganje naprej filtriramo samo SLO, ker jih ne bomo nalagali vseh
  const filteredResults = allResults.filter(r => r.lang === 'sl');

  // Filtriramo tudi tiste, ki niso povezani z iskanim filmom (npr. serija)
  const finalFilteredResults = filteredResults.filter(r => {
    const t = r.title.toLowerCase();
    
    // Čist naslov za ujemanje
    const cleanTitle = title.toLowerCase().replace(/[^a-z0-9\s]+/g, " ").trim();
    const titleKeywords = cleanTitle.split(/\s+/).filter(w => w.length > 2); 
    const keywordsMatchCount = titleKeywords.filter(keyword => t.includes(keyword)).length;
    const keywordsMatch = keywordsMatchCount >= Math.ceil(titleKeywords.length / 2) || t.includes(cleanTitle.replace(/\s/g, ''));
    
    // Izločanje serijskih/napačnih formatov
    const isWrongFormat = 
        (type === 'movie' && /(s\d+e\d+|season|episode)/.test(t)) || 
        (type === 'series' && !/(s\d+e\d+|season)/.test(t)); 

    return keywordsMatch && !isWrongFormat;
  });


  console.log(`🧩 Skupaj smo našli: ${allResults.length} rezultatov. Filtrirali smo na ${finalFilteredResults.length} slovenskih in relevantnih.`);

  if (!finalFilteredResults.length) {
    console.log(`❌ Ni bilo najdenih slovenskih in relevantnih podnapisov za ${title}`);
    cache[imdbId] = { timestamp: Date.now(), data: [] };
    saveCache(cache);
    return res.json({ subtitles: [] });
  }
  
  // 4. PRENOS IN EKSTRAKCIJA SLOVENSKIH PODNAPISOV
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
      // Ostanemo pri 'FormioSubtitles' kot User-Agentu za prenos ZIP datoteke
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V13.0.0)");
  console.log("🐍 KODI SIMULACIJA: Uporabljamo najbolj verjetno API pot in User-Agent.");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});