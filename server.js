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
  version: "3.5.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Samodejno iskanje slovenskih podnapisov s podnapisi.net",
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

// ⚡ Cache (24 ur)
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

// 🔐 Prijava - robustna verzija
async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");

  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Uporabljeni shranjeni piškotki (login preskočen).");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  try {
    await page.waitForSelector("input[name='username'], #username, .form-control[name='username']", { timeout: 30000 });
    await page.type("input[name='username'], #username, .form-control[name='username']", USERNAME, { delay: 30 });
    await page.type("input[name='password'], #password, .form-control[name='password']", PASSWORD, { delay: 30 });

    const loginButton =
      (await page.$("button[type='submit']")) ||
      (await page.$("input[type='submit']")) ||
      (await page.$("form button")) ||
      (await page.$("form input[type='button']"));
    if (loginButton) {
      await loginButton.click();
      console.log("➡️ Klik na gumb za prijavo ...");
    } else {
      console.log("⚠️ Gumb za prijavo ni bil najden, pošiljam ročno POST zahtevo.");
      await page.evaluate(
        async (user, pass) => {
          const formData = new FormData();
          formData.append("username", user);
          formData.append("password", pass);
          await fetch("/sl/login", { method: "POST", body: formData, credentials: "include" });
        },
        USERNAME,
        PASSWORD
      );
    }

    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Odjava") ||
        document.body.innerText.includes("Moj profil") ||
        document.body.innerText.includes("patagero"),
      { timeout: 30000 }
    );

    console.log("✅ Prijava uspešna.");
  } catch (err) {
    console.log("⚠️ Napaka ali počasno nalaganje login strani:", err.message);
  }

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  console.log("💾 Piškotki shranjeni za prihodnjo uporabo.");
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

// 🎬 Glavni route
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const cached = getCache(imdbId);
  if (cached) return res.json(cached);

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 20000 });

  try {
    await page.waitForSelector("table.table tbody tr", { timeout: 8000 });

    const results = await page.$$eval("table.table tbody tr", (rows) =>
      rows
        .map((row) => {
          const link = row.querySelector("a[href*='/download']")?.href || null;
          const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
          return link ? { link, title } : null;
        })
        .filter(Boolean)
    );

    if (!results.length) {
      console.log("❌ Ni bilo najdenih slovenskih podnapisov.");
      await browser.close();
      return res.json({ subtitles: [] });
    }

    console.log(`✅ Najdenih ${results.length} slovenskih podnapisov.`);
    const subtitles = [];
    let index = 1;

    for (const r of results) {
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
            url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${index}/${encodeURIComponent(
              srtFile
            )}`,
            lang: "sl",
            name: `Formio Podnapisi.NET 🇸🇮 - ${r.title}`,
          });
          console.log(`📜 Najden SRT [#${index}]: ${srtFile}`);
          index++;
        }
      } catch (err) {
        console.log(`⚠️ Napaka pri prenosu #${index}:`, err.message);
      }
    }

    await browser.close();
    const data = { subtitles };
    saveCache(imdbId, data);
    res.json(data);
  } catch (err) {
    console.log("❌ Napaka pri iskanju podnapisov:", err.message);
    await browser.close();
    res.json({ subtitles: [] });
  }
});

// 📂 strežnik za datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// ⚡ Pre-cache najbolj iskane naslove
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

// 🚀 zagon
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon 🇸🇮 aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
