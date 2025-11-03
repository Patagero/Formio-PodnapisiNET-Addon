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
  version: "3.0.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Prijavljen dostop do slovenskih podnapisov s podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"],
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

// 🔒 prijava in shranjevanje piškotkov
async function ensureLoggedIn(page) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");
  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Uporabljeni shranjeni piškotki (login preskočen).");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.type("input[name='username']", USERNAME);
  await page.type("input[name='password']", PASSWORD);
  await page.click("button[type='submit']");
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  const cookies = await page.cookies();
  fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  console.log("✅ Prijava uspešna in piškotki shranjeni.");
}

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

async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox"],
    executablePath,
    headless: chromium.headless,
  });
}

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "networkidle2" });

  await page.waitForSelector("table.table tbody tr a[href*='/download']", { timeout: 20000 });
  const html = await page.content();
  const dumpFile = path.join(TMP_DIR, `${imdbId}.html`);
  fs.writeFileSync(dumpFile, html);

  // 🔍 najdi vse slovenske povezave
  const matches = await page.$$eval("table.table tbody tr a[href*='/download']", (els) =>
    els.map((a) => a.getAttribute("href"))
  );

  if (!matches.length) {
    console.log("❌ Ni bilo najdenih slovenskih podnapisov.");
    await browser.close();
    return res.json({ subtitles: [] });
  }

  console.log(`✅ Najdenih ${matches.length} slovenskih podnapisov.`);
  const subtitles = [];
  let index = 1;

  for (const link of matches) {
    const downloadLink = "https://www.podnapisi.net" + link;
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
          name: `Formio Podnapisi.NET 🇸🇮 #${index}`,
        });
        console.log(`📜 Najden SRT [#${index}]: ${srtFile}`);
        index++;
      }
    } catch (err) {
      console.log(`⚠️ Napaka pri obdelavi #${index}:`, err.message);
    }
  }

  await browser.close();
  res.json({ subtitles });
});

app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

app.get("/dump/:id", (req, res) => {
  const dumpFile = path.join(TMP_DIR, `${req.params.id}.html`);
  if (fs.existsSync(dumpFile)) res.sendFile(dumpFile);
  else res.status(404).send("Dump not found");
});

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon 🇸🇮 aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
