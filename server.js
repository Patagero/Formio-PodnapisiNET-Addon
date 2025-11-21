import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { load as cheerioLoad } from "cheerio";
import manifest from "./manifest.json" assert { type: "json" };

const app = express();
app.use(cors());
app.use(express.json());
app.use((req, _res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;
const LOGIN_URL = "https://www.podnapisi.net/sl/login";

// 🔐 ENV KONFIG
const POD_USER = process.env.PODNAPISI_USER || "";
const POD_PASS = process.env.PODNAPISI_PASS || "";
const OMDB_KEY = process.env.OMDB_API_KEY || "";

// ❗ Brez uporabniškega / gesla nima smisla
if (!POD_USER || !POD_PASS) {
  console.warn(
    "⚠️  PODNAPISI_USER ali PODNAPISI_PASS nista nastavljena! Prijava ne bo delovala."
  );
}

let globalCookies = null;
let lastLoginTime = 0;

// 🔐 PRIJAVA NA PODNAPISI.NET
async function ensureLoggedIn() {
  const now = Date.now();
  if (globalCookies && now - lastLoginTime < 24 * 60 * 60 * 1000) {
    console.log("🍪 Piškotki so še veljavni – prijava preskočena.");
    return globalCookies;
  }

  if (!POD_USER || !POD_PASS) {
    console.log("⚠️  Manjkajo PODNAPISI_USER / PODNAPISI_PASS – prijava preskočena.");
    return [];
  }

  console.log("🔐 Prijavljam se v podnapisi.net ...");
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2", timeout: 60000 });

    await page.waitForSelector("input[name='username']", { timeout: 20000 });
    await page.type("input[name='username']", POD_USER, { delay: 30 });
    await page.type("input[name='password']", POD_PASS, { delay: 30 });
    await Promise.all([
      page.click("button[type='submit'], input[type='submit']"),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 })
    ]);

    const bodyText = await page.evaluate(() => document.body.innerText || "");
    if (bodyText.includes("Odjava") || bodyText.includes("Moj profil")) {
      console.log("✅ Prijava uspešna.");
    } else {
      console.log("⚠️  Prijava morda nepopolna (redirect ali CAPTCHA).");
    }

    const cookies = await page.cookies();
    globalCookies = cookies;
    lastLoginTime = Date.now();
    console.log("💾 Piškotki shranjeni v RAM (veljajo 24h).");
    return cookies;
  } catch (err) {
    console.error("⚠️  Napaka pri prijavi:", err.message);
    return globalCookies || [];
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// 🎬 IMDb → naslov (opcijsko, če OMDB_KEY obstaja)
async function getTitleFromIMDb(imdbId) {
  if (!OMDB_KEY) {
    console.log("ℹ️  OMDB_API_KEY ni nastavljen – vračam kar IMDb ID.");
    return imdbId;
  }

  try {
    const res = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`
    );
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return data.Title.trim();
    }
  } catch (err) {
    console.log("⚠️  Napaka IMDb API:", err.message);
  }
  return imdbId;
}

// 🔍 Iskanje slovenskih podnapisov po naslovu
async function scrapeSubtitlesByTitle(title) {
  console.log(`🌍 Iščem slovenske podnapise za: ${title}`);

  const cookies = await ensureLoggedIn();
  const cookieHeader = (cookies || [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
    title
  )}&language=sl`;

  // 1️⃣ POSKUS – fetch HTML in cheerio
  try {
    const res = await fetch(searchUrl, {
      headers: {
        Cookie: cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept-Language": "sl,en-US;q=0.9,en;q=0.8"
      }
    });

    const html = await res.text();
    const $ = cheerioLoad(html);
    const results = [];

    $("table.table tbody tr").each((_, row) => {
      const $row = $(row);

      // TODO: po potrebi prilagodi selektor jezika glede na dejanski HTML
      const langCellText = $row.text().toLowerCase();
      const isSlovenian =
        langCellText.includes("slovenski") ||
        langCellText.includes("slovenian") ||
        langCellText.includes("slovene");

      const linkEl =
        $row.find("a[href*='/download']").attr("href") ||
        $row.find("a[href*='/subtitles/']").attr("href");
      const name = $row.find("a").first().text().trim();

      if (linkEl && isSlovenian) {
        const link = linkEl.startsWith("http")
          ? linkEl
          : `https://www.podnapisi.net${linkEl}`;
        results.push({ name: name || "Neznan", link, lang: "slv" });
      }
    });

    if (results.length > 0) {
      console.log(`✅ Najdenih ${results.length} slovenskih podnapisov (HTML fetch)`);
      return results;
    } else {
      console.log("⚠️  Ni rezultatov s fetch metodo – preklop na Puppeteer fallback...");
    }
  } catch (err) {
    console.log("⚠️  Napaka pri fetch scraping:", err.message);
  }

  // 2️⃣ Puppeteer fallback (če fetch ne najde nič)
  let browser;
  try {
    browser = await puppeteer.launch({
      args: [...chromium.args, "--no-sandbox", "--disable-dev-shm-usage"],
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    if (cookieHeader) {
      await page.setExtraHTTPHeaders({
        Cookie: cookieHeader
      });
    }
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
    );

    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });

    const results = await page.$$eval("table.table tbody tr", (rows) =>
      rows
        .map((r) => {
          const linkEl =
            r.querySelector("a[href*='/download']")?.getAttribute("href") ||
            r.querySelector("a[href*='/subtitles/']")?.getAttribute("href");
          const name = r.querySelector("a")?.textContent?.trim() || "Neznan";
          const txt = (r.innerText || "").toLowerCase();
          const isSlovenian =
            txt.includes("slovenski") ||
            txt.includes("slovenian") ||
            txt.includes("slovene");
          if (!linkEl || !isSlovenian) return null;
          const link = linkEl.startsWith("http")
            ? linkEl
            : "https://www.podnapisi.net" + linkEl;
          return { name, link, lang: "slv" };
        })
        .filter(Boolean)
    );

    console.log(
      `✅ Najdenih ${results.length} slovenskih podnapisov (Puppeteer fallback)`
    );
    return results;
  } catch (err) {
    console.error("⚠️  Napaka Puppeteer fallback:", err.message);
    return [];
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

// 📜 Manifest
app.get("/manifest.json", (_req, res) => {
  res.json(manifest);
});

// 🎬 Stremio subtitles endpoint
// Stremio kliče npr: /subtitles/movie/tt1234567.json
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  console.log("==================================================");
  try {
    const rawId = req.params.imdbId || "";
    // Pazimo na morebitno podvojeno "tt"
    const imdbId = rawId.startsWith("tt") ? rawId : `tt${rawId}`;
    console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

    const searchTerm = await getTitleFromIMDb(imdbId);
    console.log(`🎯 Iščem samo po imenu filma: ${searchTerm}`);

    const results = await scrapeSubtitlesByTitle(searchTerm);

    if (!results.length) {
      console.log(`❌ Ni najdenih podnapisov za: ${searchTerm}`);
      return res.json({ subtitles: [] });
    }

    const subtitles = results.map((r, i) => ({
      id: `formio-${i + 1}`,
      lang: r.lang || "slv",
      url: r.link,
      title: `${r.name} 🇸🇮`
    }));

    console.log(`📦 Pošiljam ${subtitles.length} podnapisov`);
    res.json({ subtitles });
  } catch (err) {
    console.error("💥 Kritična napaka v subtitles handlerju:", err.message);
    res.json({ subtitles: [] });
  }
});

app.get("/", (_req, res) => res.redirect("/manifest.json"));
app.get("/health", (_req, res) => res.send("✅ OK"));

app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v17.0.0 deluje na portu ${PORT}`);
  console.log("==================================================");
});
