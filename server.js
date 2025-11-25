import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "6.3.3",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Išče samo slovenske podnapise",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

const TMP_DIR = path.join(process.cwd(), "tmp");
const LOGIN_URL = "https://www.podnapisi.net/sl/login";

const USERNAME = "patagero";
const PASSWORD = "Formio1978";

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

let globalBrowser = null;
let globalCookies = null;

// =====================================================================================
// BROWSER — 100% stabilno delovanje s chromium 112 + puppeteer-core 18
// =====================================================================================

async function getBrowser() {
  if (globalBrowser) return globalBrowser;

  const executablePath = await chromium.executablePath();  // ← DELUJE ZA 112.0.2

  globalBrowser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
    executablePath,
    headless: chromium.headless
  });

  return globalBrowser;
}

// =====================================================================================
// LOGIN
// =====================================================================================

async function ensureLoggedIn(page) {
  if (globalCookies) {
    await page.setCookie(...globalCookies);
    return;
  }

  await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

  await page.type("input[name='username']", USERNAME, { delay: 20 });
  await page.type("input[name='password']", PASSWORD, { delay: 20 });

  await Promise.all([
    page.click("button[type='submit'], input[type='submit']"),
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 60000 })
  ]);

  globalCookies = await page.cookies();
}

// =====================================================================================
// SEARCH SLOVENIAN SUBTITLES
// =====================================================================================

async function searchSlSubs(browser, title) {
  const page = await browser.newPage();

  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
  await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

  const results = await page.$$eval("table.table tbody tr", rows =>
    rows.map(row => {
      const link = row.querySelector("a[href*='/download']")?.href;
      const txt = row.querySelector("a[href*='/download']")?.innerText?.trim();
      if (!link || !txt) return null;
      return { link, title: txt };
    }).filter(Boolean)
  );

  return results;
}

// =====================================================================================
// ROUTE
// =====================================================================================

app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;

  let title = imdbId;
  try {
    const data = await (await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`)).json();
    if (data?.Title) title = data.Title;
  } catch {}

  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page);

  const found = await searchSlSubs(browser, title);

  if (!found.length) return res.json({ subtitles: [] });

  res.json({
    subtitles: found.map((r, i) => ({
      id: `formio-${i + 1}`,
      lang: "sl",
      url: r.link,
      title: `${r.title} 🇸🇮`
    }))
  });
});

// =====================================================================================
// MANIFEST
// =====================================================================================

app.get("/manifest.json", (req, res) => res.json(manifest));

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("  Formio Podnapisi.NET 🇸🇮 — ACTIVE");
  console.log("==================================================");
});
