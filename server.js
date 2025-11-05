import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import AdmZip from "adm-zip";

// *** VSTAVLJENI PODATKI ZA PRIJAVO ***
const USERNAME = "patagero";
const PASSWORD = "Formio1978";
// **********************************

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "8.0.4",
  name: "Formio Podnapisi.NET 🇸🇮 (Regex Napad)",
  description: "Uporablja iskanje po IMDb ID-ju, pri neuspehu preklopi na robusten Regex Fallback.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- KONSTANTE & CACHE ---
const TMP_DIR = path.join(process.cwd(), "tmp");
const CACHE_FILE = path.join(TMP_DIR, "cache.json");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";
const COOKIES_PATH = path.join(TMP_DIR, "cookies.json");

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(CACHE_FILE)) fs.writeFileSync(CACHE_FILE, JSON.stringify({}, null, 2));

const langMap = { sl: "🇸🇮" };

function loadCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); }
  catch { return {}; }
}
function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

let globalBrowser = null;
let globalCookiesLoaded = false;

// --- POMOŽNE FUNKCIJE ---

// ✅ POSODOBLJENA FUNKCIJA ZA RENDER
async function getBrowser() {
  if (globalBrowser) return globalBrowser;

  const executablePath = await chromium.executablePath();
  console.log("📁 Render Chromium path:", executablePath);

  globalBrowser = await puppeteer.launch({
    args: [
      ...chromium.args,
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--single-process",
      "--disable-dev-shm-usage"
    ],
    executablePath,
    headless: chromium.headless,
    userDataDir: "/tmp/puppeteer" // <-- pomembno za Render!
  });

  return globalBrowser;
}

async function ensureLoggedIn(page) {
  if (fs.existsSync(COOKIES_PATH) && globalCookiesLoaded) {
    const cookies = JSON.parse(fs.readFileSync(COOKIES_PATH, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Uporabljeni obstoječi piškotki (preskočen login).");
    return;
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise(r => setTimeout(r, 4000)); 

  try {
    const usernameSelector = "input[name*='username']";
    const passwordSelector = "input[name*='password']";
    
    await page.waitForSelector(usernameSelector, { timeout: 30000 });
    await page.type(usernameSelector, USERNAME, { delay: 25 });
    await page.type(passwordSelector, PASSWORD, { delay: 25 });
    
    const loginBtn = await page.$("form[action*='login'] button") || await page.$("form[action*='login'] input[type='submit']");
    if (!loginBtn) throw new Error("Gumb za prijavo ni najden.");
    
    await loginBtn.click();
    
    await page.waitForFunction(
      () => document.body.innerText.includes("Odjava") || document.body.innerText.includes("Moj profil"),
      { timeout: 30000 }
    );
    console.log("✅ Prijava uspešna.");
  } catch(error) {
    console.log(`⚠️ Prijava ni potrjena: ${error.message} (morda CAPTCHA/blokada).`);
  }

  const cookies = await page.cookies();
  fs.writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
  globalCookiesLoaded = true;
  console.log("💾 Piškotki shranjeni.");
}

async function getTitleAndYear(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year}) [Tip: ${data.Type}]`);
      return { title: data.Title.trim(), year: data.Year || "", type: data.Type || "movie" };
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return { title: imdbId, year: "", type: "movie" };
}

// (OSTALO ostane popolnoma enako kot v tvoji datoteki — parsing, filtering, download, manifest, listen...)

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 AKTIVEN (V8.0.4, Render-safe Chromium)");
  console.log("💥 Regex prioriteta pri iskanju po naslovu aktivna");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
