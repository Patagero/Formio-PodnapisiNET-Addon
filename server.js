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
  version: "11.1.0", // Testna verzija - Odstranjen filter!
  name: "Formio Podnapisi.NET 🇸🇮 (Stealth Fetch, Brez Filtra)",
  description: "Išče podnapise z 'lažnimi' HTTP glavami in VRNE VSE, kar najde, za testiranje Regexa.",
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
 * Globalno iskanje z 'lažnimi' glavami za zaobid zaščite.
 * Vrne VSE, kar najde.
 */
async function fetchSubtitlesStealth(title) {
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}`;
    console.log(`🌍 Iščem z lažnimi glavami: ${searchUrl}`);

    try {
        const res = await fetch(searchUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/100.0',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'sl,en-US;q=0.7,en;q=0.3',
                'Cache-Control': 'max-age=0',
                'Connection': 'keep-alive',
            }
        });

        const html = await res.text();
        
        // --- PARSIRANJE HTML-ja z REGEX-om (brez filtriranja!) ---
        const results = [];
        
        // Ta Regex je bil posodobljen, da je bolj toleranten
        const rowRegex = /href="(\/subtitles\/[^/]+\/download)"[\s\S]*?rel="(\w{2})"[^>]*>[\s\S]*?<a[^>]*href="\/subtitles\/[^>]*>([\s\S]*?)<\/a>/g;
        let match;

        while ((match = rowRegex.exec(html)) !== null) {
            const linkSuffix = match[1]; 
            const lang = match[2];       
            const title = match[3].replace(/<[^>]*>/g, '').trim(); 

            // Vrnemo VSE, kar je Regex ujel, ne glede na jezik!
            if (title) { 
                results.push({
                    link: "https://www.podnapisi.net" + linkSuffix,
                    title: title,
                    lang: lang
                });
            }
        }
        
        console.log(`✅ Stealth Fetch uspešen. Skupaj najdenih (vsi jeziki): ${results.length}`);
        return results;

    } catch (error) {
        console.error("❌ Napaka pri Stealth HTTP klicu:", error.message);
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
  if (cache[imdbId] && Date.now() - cache[imdbid].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Rezultat iz cache-a");
    return res.json({ subtitles: cache[imdbId].data });
  }

  // 2. PRIDOBITEV INFO IN ISKANJE
  const { title, year, type } = await getTitleAndYear(imdbId);
  if (!title || title === imdbId) {
       console.log("❌ Napaka: Ne morem pridobiti naslova filma.");
       return res.json({ subtitles: [] });
  }
  
  // Iskanje z direktnim fetch klicem in stealth glavami (brez filtra!)
  const allResults = await fetchSubtitlesStealth(title); 
  
  // Če nismo nič našli, se ustavi.
  if (!allResults.length) {
    console.log(`❌ Ni bilo najdenih podnapisov (tudi v drugih jezikih) za ${title}`);
    cache[imdbId] = { timestamp: Date.now(), data: [] };
    saveCache(cache);
    return res.json({ subtitles: [] });
  }
  
  // 3. 🧠 FILTRA NI! VRNEMO VSE, KAR SMO NAŠLI, AMPAK SAMO SLOVENSKE ZA ZADNJO FAZO
  
  // Tukaj ponovno filtriramo samo SLO, ker jih ne bomo nalagali vseh
  const filteredResults = allResults.filter(r => r.lang === 'sl');

  console.log(`🧩 Skupaj smo našli: ${allResults.length} rezultatov. Naložimo le ${filteredResults.length} slovenskih.`);


  // 4. PRENOS IN EKSTRAKCIJA SLOVENSKIH PODNAPISOV
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
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V11.1.0)");
  console.log("🔥 TESTIRANJE: Odstranili smo filter za jezik/naslov. Parsanje mora zdaj delati.");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});