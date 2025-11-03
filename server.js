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
  version: "4.0.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Bliskovito iskanje slovenskih podnapisov s podnapisi.net (z lokalnim predpomnjenjem)",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"],
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_DIR = path.join(TMP_DIR, "cache");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

// 🧹 Počisti stare datoteke (2 dni)
function cleanupOldFiles() {
  const cutoff = Date.now() - 2 * 24 * 60 * 60 * 1000;
  for (const dir of [TMP_DIR]) {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile() && fs.statSync(p).mtimeMs < cutoff) {
        fs.unlinkSync(p);
        console.log("🧹 Izbrisano:", p);
      }
    }
  }
}
cleanupOldFiles();

// ⚡ Cache
function getCache(imdbId) {
  const file = path.join(CACHE_DIR, imdbId + ".json");
  if (fs.existsSync(file)) {
    const age = Date.now() - fs.statSync(file).mtimeMs;
    if (age < 24 * 60 * 60 * 1000) {
      console.log("⚡ Cache zadetek za:", imdbId);
      return JSON.parse(fs.readFileSync(file, "utf8"));
    }
  }
  return null;
}
function saveCache(imdbId, data) {
  fs.writeFileSync(path.join(CACHE_DIR, imdbId + ".json"), JSON.stringify(data, null, 2));
}

// 🔐 Prijava
async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");
  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Piškotki naloženi (preskočena prijava)");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  try {
    await page.waitForSelector("input[name='username']", { timeout: 20000 });
    await page.type("input[name='username']", USERNAME, { delay: 25 });
    await page.type("input[name='password']", PASSWORD, { delay: 25 });
    await page.click("button[type='submit']");
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Odjava") ||
        document.body.innerText.includes("Moj profil"),
      { timeout: 30000 }
    );
    console.log("✅ Prijava uspešna");
    const cookies = await page.cookies();
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  } catch (e) {
    console.log("⚠️ Napaka pri prijavi:", e.message);
  }
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

// 🧩 Chromium
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox"],
    executablePath,
    headless: chromium.headless,
  });
}

// 🧠 Glavna funkcija za iskanje
async function scrapeAndSave(imdbId) {
  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 20000 });

  let subtitles = [];

  try {
    await page.waitForSelector("table.table tbody tr", { timeout: 8000 });
    const results = await page.$$eval("table.table tbody tr", (rows) =>
      rows
        .map((r) => {
          const link = r.querySelector("a[href*='/download']")?.href || null;
          const title = r.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
          return link ? { link, title } : null;
        })
        .filter(Boolean)
    );

    console.log(`✅ Najdenih ${results.length} slovenskih podnapisov.`);
    let index = 1;

    for (const r of results) {
      const zipPath = path.join(TMP_DIR, `${imdbId}_${index}.zip`);
      const extractDir = path.join(TMP_DIR, `${imdbId}_${index}`);

      try {
        const zipRes = await fetch(r.link);
        const buf = Buffer.from(await zipRes.arrayBuffer());
        fs.writeFileSync(zipPath, buf);

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);

        const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
        if (srtFile) {
          subtitles.push({
            id: `formio-podnapisi-${index}`,
            url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${index}/${encodeURIComponent(
              srtFile
            )}`,
            lang: "sl",
            name: `Formio 🇸🇮 - ${r.title}`,
          });
          console.log(`📜 Najden SRT [#${index}]: ${srtFile}`);
          index++;
        }
      } catch (err) {
        console.log(`⚠️ Napaka pri prenosu #${index}:`, err.message);
      }
    }
  } catch (e) {
    console.log("⚠️ Napaka Puppeteer:", e.message);
  }

  await browser.close();
  const data = { subtitles };
  saveCache(imdbId, data);
  return data;
}

// 🎬 Route za podnapise (instant cache + background refresh)
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const cached = getCache(imdbId);
  if (cached) {
    console.log("⚡ Vračam cache, Puppeteer v ozadju ...");
    res.json(cached);
    // 🔄 Osvežimo cache v ozadju
    (async () => {
      try {
        console.log(`🕵️‍♂️ Osvežujem cache za ${imdbId} ...`);
        await scrapeAndSave(imdbId);
      } catch (err) {
        console.log("⚠️ Napaka background refresh:", err.message);
      }
    })();
    return;
  }

  const data = await scrapeAndSave(imdbId);
  res.json(data);
});

// 📂 Strežnik za SRT datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Pre-cache znane naslove
const PRELOAD_IDS = ["tt0120338", "tt0133093", "tt1375666"];
(async () => {
  for (const id of PRELOAD_IDS) {
    const cached = getCache(id);
    if (!cached) {
      console.log(`⚡ Pre-caching ${id} ...`);
      await fetch(`https://formio-podnapisinet-addon-1.onrender.com/subtitles/movie/${id}.json`);
    }
  }
})();

// 🔥 Zagon
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon 🇸🇮 aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
