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
  version: "4.3.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Samodejno išče slovenske podnapise s podnapisi.net (login pred iskanjem + stabilno prijavljanje)",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

// 🔐 Prijava v podnapisi.net (stabilna + fallback)
async function performLogin(browser) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");

  // Če obstajajo piškotki, preskočimo prijavo
  if (fs.existsSync(cookiesPath)) {
    console.log("🍪 Piškotki obstajajo, preskočim prijavo.");
    return JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  const page = await browser.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  try {
    // počakamo, da se login form naloži
    await page.waitForSelector("form[action*='login']", { timeout: 20000 });
    await page.type("input[name='username'], #username", USERNAME, { delay: 25 });
    await page.type("input[name='password'], #password", PASSWORD, { delay: 25 });

    // poskusi klikniti več različnih gumbov
    const selectors = [
      "button[type='submit']",
      "input[type='submit']",
      "button.btn-primary",
      "form button",
      ".btn.btn-success",
      "button.login",
    ];

    let clicked = false;
    for (const sel of selectors) {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        console.log(`➡️ Klik na gumb ${sel}`);
        clicked = true;
        break;
      }
    }

    // če gumb ne obstaja → pošlji ročni POST
    if (!clicked) {
      console.log("⚠️ Gumb za prijavo ni najden — pošiljam ročni POST ...");
      await page.evaluate(
        async (user, pass) => {
          const form = new FormData();
          form.append("username", user);
          form.append("password", pass);
          await fetch("/sl/login", { method: "POST", body: form, credentials: "include" });
        },
        USERNAME,
        PASSWORD
      );
    }

    // čakamo na znak prijave
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Odjava") ||
        document.body.innerText.includes("Moj profil") ||
        document.body.innerText.includes("patagero"),
      { timeout: 30000 }
    );

    console.log("✅ Prijava uspešna");
    const cookies = await page.cookies();
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
    await page.close();
    return cookies;
  } catch (err) {
    console.log("⚠️ Napaka pri prijavi:", err.message);
    await page.close();
    return [];
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
    headless: chromium.headless
  });
}

// 🧠 Glavna funkcija za iskanje
async function scrapeAndSave(imdbId) {
  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);
  const browser = await getBrowser();

  // 1️⃣ Najprej login
  const cookies = await performLogin(browser);

  // 2️⃣ Nato iskanje
  const page = await browser.newPage();
  if (cookies?.length) await page.setCookie(...cookies);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 30000 });

  let subtitles = [];
  try {
    await page.waitForSelector("table.table tbody tr, a[href*='/download']", { timeout: 15000 });

    const results = await page.$$eval("table.table tbody tr", (rows) =>
      rows
        .map((r) => {
          const link = r.querySelector("a[href*='/download']")?.href;
          const title = r.querySelector("a[href*='/download']")?.innerText?.trim();
          return link && title ? { link, title } : null;
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
            name: `Formio 🇸🇮 - ${r.title}`
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
  return { subtitles };
}

// 📂 Strežnik za datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🎬 Route za podnapise
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", req.params.id);

  const data = await scrapeAndSave(req.params.id);
  res.json(data);
});

// 🔥 Zagon
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon 🇸🇮 aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
