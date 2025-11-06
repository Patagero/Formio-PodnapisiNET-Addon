import express from "express";
import puppeteer from "puppeteer";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

// 🔧 Nastavitve za Render-safe Puppeteer
const launchOptions = {
  args: [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
  ],
  headless: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "/usr/bin/google-chrome",
};

// 🧩 Glavna funkcija za pridobivanje slovenskih podnapisov
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
  );

  try {
    // 🔐 Prijava
    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/login", { waitUntil: "networkidle2" });
    await page.type('input[name="username"]', "patagero");
    await page.type('input[name="password"]', "Formio1978");
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle2", timeout: 10000 }).catch(() => {}),
    ]);
    console.log("✅ Prijava uspešna");

    // 🔎 Iskanje
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
      title
    )}&language=sl`;
    console.log("🌍 Iskanje:", searchUrl);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // 📑 Zajem rezultatov
    const subtitles = await page.evaluate(() => {
      const items = [];
      document.querySelectorAll(".subtitle-entry").forEach((el) => {
        const title = el.querySelector(".title")?.innerText.trim();
        const lang = el.querySelector(".flags img")?.alt?.toLowerCase() || "";
        const link = el.querySelector("a[href*='/sl/subtitles/']")?.href;
        if (lang.includes("slovenščina") && link) {
          items.push({ title, link });
        }
      });
      return items;
    });

    console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);

    // 🔗 Pridobi ZIP povezave
    const results = [];
    for (const sub of subtitles) {
      try {
        await page.goto(sub.link, { waitUntil: "domcontentloaded" });
        const zip = await page.evaluate(() => {
          const btn = document.querySelector('a[href*="/static/ftp/"]');
          return btn ? btn.href : null;
        });
        if (zip) results.push({ ...sub, zip });
      } catch (e) {
        console.warn("⚠️ Napaka pri branju strani podnapisa:", e.message);
      }
    }

    await browser.close();

    console.log(`🧩 Po filtriranju ostane ${results.length} 🇸🇮 relevantnih podnapisov.`);
    return results;
  } catch (err) {
    console.error("❌ Napaka pri scrapanju:", err.message);
    await browser.close();
    return { error: "scrape_failed" };
  }
}

// 📜 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "10.0.7",
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

// 🎬 Endpoint za iskanje podnapisov po IMDb ID ali naslovu
app.get("/subtitles/movie/:query.json", async (req, res) => {
  let query = req.params.query.trim();
  let title = query;

  // 🎞️ IMDb ID → naslov (OMDb)
  if (/^tt\d+$/.test(query)) {
    console.log(`🎬 IMDb ID zaznan: ${query}`);
    try {
      const omdb = await fetch(`https://www.omdbapi.com/?i=${query}&apikey=2a7e2e9e`);
      const data = await omdb.json();
      if (data && data.Title) {
        title = data.Title;
        console.log(`🎬 IMDb → ${data.Title} (${data.Year || "?"})`);
      } else {
        console.warn("⚠️ OMDb ni vrnil naslova, uporabljam IMDb ID kot fallback");
      }
    } catch (err) {
      console.warn("⚠️ Napaka pri OMDb iskanju:", err.message);
    }
  }

  // 🔍 Iskanje podnapisov
  try {
    const results = await scrapeSubtitlesByTitle(title);
    if (!results || results.error) return res.json({ subtitles: [] });

    const subtitles = results.map((s, i) => ({
      id: `sl-${i + 1}`,
      url: s.zip,
      lang: "slv",
      title: s.title || title,
    }));

    console.log(`📦 Pripravljenih ${subtitles.length} podnapisov za Stremio.`);
    res.json({ subtitles });
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err.message);
    res.json({ subtitles: [] });
  }
});

// 🔁 Root → preusmeri na manifest
app.get("/", (req, res) => res.redirect("/manifest.json"));

// 🚀 Zaženi strežnik
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v10.0.7 posluša na portu ${PORT}`);
  console.log("==================================================");
});
