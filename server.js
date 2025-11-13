import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  console.log(`➡️  [${req.method}] ${req.url}`);
  next();
});

const PORT = process.env.PORT || 10000;

// 🔐 Prijavni podatki
const PODNAPISI_USER = "patagero";
const PODNAPISI_PASS = "Formio1978";

// 🔁 Cache piškotkov
let cachedCookies = null;

// 🎬 IMDb → naslov
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return data.Title.trim();
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// ⚡ Hibridna prijava + API
async function fastSearchSubtitles(title) {
  console.log(`🌍 Hibridni login + API poizvedba za: ${title}`);
  const apiUrl = `https://www.podnapisi.net/api/subtitles?keywords=${encodeURIComponent(title)}&language=sl`;

  try {
    // 🔐 Pridobi piškotke, če jih še ni
    if (!cachedCookies) {
      console.log("🔐 Pridobivam sveže piškotke iz prijave ...");
      const browser = await puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
      const page = await browser.newPage();

      await page.goto("https://www.podnapisi.net/sl/login", {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });

      // 🔍 Dinamično poišči input polja
      const inputs = await page.$$eval("input", (els) =>
        els.map((e) => ({
          name: e.name || e.id || "",
          type: e.type || "",
        }))
      );

      const userSelector =
        inputs.find((i) => /user/i.test(i.name) || i.type === "text")?.name ||
        "input[type='text']";
      const passSelector =
        inputs.find((i) => /pass/i.test(i.name))?.name ||
        "input[type='password']";

      console.log(`🧩 Uporabljam selectorje: ${userSelector}, ${passSelector}`);

      // 🔑 Vnesi prijavo
      await page.type(`[name='${userSelector}'], #${userSelector}`, PODNAPISI_USER, { delay: 40 }).catch(() => {});
      await page.type(`[name='${passSelector}'], #${passSelector}`, PODNAPISI_PASS, { delay: 40 }).catch(() => {});

      // 🖱 Klik na prvi submit gumb
      const button = await page.$("button[type='submit'], input[type='submit']");
      if (button) {
        await Promise.all([
          button.click(),
          page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }),
        ]);
      } else {
        console.log("⚠️ Gumb za prijavo ni bil najden, nadaljujem.");
      }

      const bodyText = await page.evaluate(() => document.body.innerText);
      if (bodyText.includes("Odjava") || bodyText.includes("Moj profil")) {
        console.log("✅ Prijava uspešna.");
      } else {
        console.log("⚠️ Prijava ni potrjena (morda CAPTCHA ali redirect).");
      }

      cachedCookies = await page.cookies();
      await browser.close();
      console.log("💾 Piškotki pridobljeni in shranjeni v RAM.");
    }

    const cookieHeader = cachedCookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // 🔎 API poizvedba z avtorizacijo
    const apiRes = await fetch(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json, text/plain, */*",
        "Cookie": cookieHeader,
      },
    });

    if (!apiRes.ok) {
      console.log(`⚠️ API napaka: ${apiRes.status}`);
      return [];
    }

    const json = await apiRes.json();
    if (!json?.data || !Array.isArray(json.data)) {
      console.log("⚠️ API ni vrnil veljavnih rezultatov");
      return [];
    }

    const subtitles = json.data
      .filter((sub) => sub.language?.slug === "sl")
      .map((sub) => ({
        name: sub.release || sub.title || "Neznan",
        link: `https://www.podnapisi.net${sub.url}`,
      }));

    console.log(`✅ Najdenih ${subtitles.length} 🇸🇮 podnapisov za: ${title}`);
    return subtitles;
  } catch (err) {
    console.error("❌ Napaka pri prijavi ali API klicu:", err.message);
    cachedCookies = null;
    return [];
  }
}

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "13.1.0",
    name: "Formio Podnapisi.NET 🇸🇮 FAST",
    description: "Hiter iskalnik slovenskih podnapisov (API + prijava)",
    types: ["movie", "series"],
    resources: [
      { name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] },
    ],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// 🎬 Endpoint za iskanje po imenu
app.get(
  [
    "/subtitles/movie/:imdbId.json",
    "/subtitles/:imdbId.json",
    "/subtitles/movie/:imdbId/*",
    "/subtitles/:imdbId/*",
  ],
  async (req, res) => {
    console.log("==================================================");
    const imdbId = req.params.imdbId;
    const fullUrl = req.url;

    console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);
    console.log(`🧩 Celoten URL: ${fullUrl}`);

    // 📂 Izlušči ime datoteke
    const filenameMatch = decodeURIComponent(fullUrl).match(/filename=([^&]+)/);
    let searchTerm = null;

    if (filenameMatch && filenameMatch[1]) {
      let rawName = decodeURIComponent(filenameMatch[1])
        .replace(/\.[a-z0-9]{2,4}$/i, "")
        .replace(/[\._\-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      // počisti ime
      rawName = rawName.replace(
        /\b(2160p|1080p|720p|480p|4k|uhd|hdr|hdr10|hevc|x264|x265|dvdrip|brrip|remux|bluray|webrip|web-dl|rip|dts|aac|atmos|5\.1|7\.1|truehd|avc|upscale|final|repack|proper|extended|edition|cd\d+|part\d+|slo|slv|ahq|remastered|uhd|bd|ai_upscale)\b/gi,
        ""
      );

      const words = rawName
        .split(" ")
        .filter((w) => /^[A-Za-zčćžšđ]/i.test(w) && w.length > 2);
      searchTerm = words.slice(0, 3).join(" ").trim() || "Titanic";
      console.log(`🎯 Poenostavljeno ime za iskanje: ${searchTerm}`);
    }

    if (!searchTerm) {
      searchTerm = await getTitleFromIMDb(imdbId);
      console.log(`🎬 Iščem po IMDb naslovu: ${searchTerm}`);
    }

    const results = await fastSearchSubtitles(searchTerm);

    if (!results.length) {
      console.log(`❌ Ni najdenih podnapisov za: ${searchTerm}`);
      return res.json({ subtitles: [] });
    }

    const subtitles = results.map((r, i) => ({
      id: `formio-${i + 1}`,
      lang: "sl",
      url: r.link,
      name: `${r.name} 🇸🇮`,
    }));

    console.log(`📦 Pošiljam ${subtitles.length} podnapisov`);
    res.json({ subtitles });
  }
);

// 🩺 Health check
app.get("/health", (_, res) => res.send("✅ OK"));

// 🏁 Root → manifest
app.get("/", (_, res) => res.redirect("/manifest.json"));

// 🚀 Zagon
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 FAST v13.1.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
