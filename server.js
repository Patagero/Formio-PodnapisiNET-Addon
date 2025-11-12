import express from "express";
import fetch from "node-fetch";
import puppeteer from "puppeteer";
import chromium from "@sparticuz/chromium";

const app = express();
const PORT = process.env.PORT || 10000;

// ===============================
// 📜 Manifest za Stremio
// ===============================
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "10.1.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Samodejni iskalnik slovenskih podnapisov s portala Podnapisi.NET",
    types: ["movie"],
    resources: [
      {
        name: "subtitles",
        types: ["movie"],
        idPrefixes: ["tt"],
      },
    ],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
    },
  });
});

// 🔁 Root preusmeri na manifest
app.get("/", (req, res) => res.redirect("/manifest.json"));

// ===============================
// 🎬 Glavna funkcija: Scrapanje podnapisov
// ===============================
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  const browser = await puppeteer.launch({
    args: [...chromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

  const page = await browser.newPage();

  try {
    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/login", { waitUntil: "networkidle2" });
    await page.type("#username", "patagero");
    await page.type("#password", "Formio1978");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }),
    ]);
    console.log("✅ Prijava uspešna");

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
    console.log("🌍 Iskanje:", searchUrl);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });

    await page.waitForSelector(".subtitle-entry", { timeout: 10000 }).catch(() =>
      console.log("⚠️ Elementi niso bili pravočasno naloženi – nadaljujem.")
    );

    const subtitles = await page.evaluate(() => {
      const subs = [];
      document.querySelectorAll(".subtitle-entry").forEach((el) => {
        const name = el.querySelector(".release")?.innerText?.trim() || "Neznan";
        const link = el.querySelector("a")?.href || null;
        if (name && link) subs.push({ name, link });
      });
      return subs;
    });

    console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);

    const slSubs = subtitles.filter((s) => s.name.toLowerCase().includes(title.toLowerCase()));
    console.log(`🧩 Po filtriranju ostane ${slSubs.length} 🇸🇮 relevantnih podnapisov.`);

    await browser.close();
    return slSubs;
  } catch (err) {
    console.error("❌ Napaka pri iskanju podnapisov:", err.message);
    await browser.close();
    return [];
  }
}

// ===============================
// 🎬 API endpoint za Stremio (subtitles)
// ===============================
app.get("/subtitles/movie/:query.json", async (req, res) => {
  const query = req.params.query;
  console.log(`🎬 Prejemam zahtevo za IMDb: ${query}`);

  // Če pride IMDb ID (ttXXXX), ga pretvorimo v naslov
  let movieTitle = query;
  if (query.startsWith("tt")) {
    const omdbKey = "6d8fef5c"; // lahko zamenjaš z lastnim OMDb ključem
    const omdbUrl = `https://www.omdbapi.com/?i=${query}&apikey=${omdbKey}`;
    try {
      const data = await fetch(omdbUrl).then((r) => r.json());
      if (data?.Title) {
        movieTitle = data.Title;
        console.log(`🎬 IMDb → ${movieTitle} (${data.Year})`);
      }
    } catch (e) {
      console.log("⚠️ Napaka pri iskanju naslova iz IMDb ID");
    }
  }

  const results = await scrapeSubtitlesByTitle(movieTitle);

  if (!results.length) {
    return res.json([]);
  }

  const stremioSubs = results.map((s, i) => ({
    id: `podnapisi-${i}`,
    url: s.link,
    lang: "slv",
    name: s.name,
  }));

  res.json(stremioSubs);
});

// ===============================
// 🩺 Health endpoint
// ===============================
app.get("/health", async (req, res) => {
  try {
    const executable = await chromium.executablePath();
    res.json({ status: "ok", chromium: executable ? "ready" : "missing" });
  } catch {
    res.json({ status: "error", chromium: "not found" });
  }
});

// ===============================
// 🚀 Zagon strežnika
// ===============================
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v10.1.0 posluša na portu ${PORT}`);
  console.log("==================================================");
});
