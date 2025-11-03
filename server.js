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
  version: "5.3.1",
  name: "Formio Podnapisi.NET 🌍",
  description: "Išče podnapise vseh jezikov (brez prijave) z natančnimi zastavicami in jeziki",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// 📁 začasna mapa in cache
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// 🏳️ pretvorba imena jezika → ISO koda + zastavica
function normalizeLang(name) {
  if (!name) return "xx";
  const langName = name.toLowerCase();
  const map = {
    slovenian: "sl", slovenski: "sl", slovenščina: "sl",
    english: "en", angleški: "en",
    croatian: "hr", hrvatski: "hr",
    serbian: "sr", srpski: "sr",
    italian: "it", italijanski: "it",
    german: "de", nemški: "de",
    french: "fr", francoski: "fr",
    spanish: "es", španski: "es",
    russian: "ru", ruski: "ru",
    macedonian: "mk", makedonski: "mk",
    hungarian: "hu", madžarski: "hu",
    bosnian: "bs", bosanski: "bs",
    polish: "pl", poljski: "pl",
    czech: "cs", češki: "cs",
    slovak: "sk", slovaški: "sk"
  };
  return map[langName] || "xx";
}

function flagForLang(lang) {
  const map = {
    sl: "🇸🇮", en: "🇬🇧", hr: "🇭🇷", sr: "🇷🇸", it: "🇮🇹",
    de: "🇩🇪", fr: "🇫🇷", es: "🇪🇸", ru: "🇷🇺", mk: "🇲🇰",
    hu: "🇭🇺", bs: "🇧🇦", pl: "🇵🇱", cs: "🇨🇿", sk: "🇸🇰"
  };
  return map[lang] || "🌐";
}

// 🎬 IMDb → naslov
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → naslov: ${data.Title}`);
      return data.Title;
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// 🧩 Zagon Chromium
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox"],
    executablePath,
    headless: chromium.headless
  });
}

// 🔍 Glavna pot za podnapise (vsi jeziki, brez prijave)
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const cache = loadCache();
  if (cache[imdbId] && Date.now() - cache[imdbId].timestamp < 24 * 60 * 60 * 1000) {
    console.log("⚡ Vračam rezultat iz cache-a.");
    return res.json({ subtitles: cache[imdbId].data });
  }

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);

  const browser = await getBrowser();
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}`;
  console.log(`🌍 Iščem vse podnapise: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  try {
    await page.waitForSelector("table.table tbody tr", { timeout: 20000 });

    const results = await page.$$eval("table.table tbody tr", (rows) =>
      rows.map((row) => {
        const link = row.querySelector("a[href*='/download']")?.href || null;
        const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
        const langAlt = row.querySelector("td img")?.alt || "unknown";
        return link ? { link, title, langAlt } : null;
      }).filter(Boolean)
    );

    if (!results.length) {
      console.log("❌ Ni bilo najdenih podnapisov.");
      await browser.close();
      return res.json({ subtitles: [] });
    }

    console.log(`✅ Najdenih ${results.length} podnapisov.`);
    const subtitles = [];
    let index = 1;

    for (const r of results.slice(0, 40)) {
      const langCode = normalizeLang(r.langAlt);
      const flag = flagForLang(langCode);
      const finalLang = langCode?.toLowerCase() || "xx";

      const downloadLink = r.link;
      const zipPath = path.join(TMP_DIR, `${imdbId}_${index}.zip`);
      const extractDir = path.join(TMP_DIR, `${imdbId}_${index}`);

      try {
        const zipRes = await fetch(downloadLink);
        const buf = Buffer.from(await zipRes.arrayBuffer());
        fs.writeFileSync(zipPath, buf);

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);

        const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
        if (srtFile) {
          subtitles.push({
            id: `formio-podnapisi-${index}`,
            url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${index}/${encodeURIComponent(srtFile)}`,
            lang: finalLang,
            name: `${flag} ${r.title} (${finalLang.toUpperCase()})`
          });
          console.log(`📜 Najden SRT [#${index}]: ${srtFile} (${finalLang})`);
          index++;
        }
      } catch (err) {
        console.log(`⚠️ Napaka pri prenosu #${index}:`, err.message);
      }
    }

    await browser.close();
    cache[imdbId] = { timestamp: Date.now(), data: subtitles };
    saveCache(cache);
    res.json({ subtitles });
  } catch (err) {
    console.log("❌ Napaka pri iskanju podnapisov:", err.message);
    await browser.close();
    res.json({ subtitles: [] });
  }
});

// 📂 Strežnik za datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Zagon
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🌍 (vsi jeziki, pravilne oznake, cache) aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
