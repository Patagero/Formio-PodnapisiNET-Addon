import express from "express";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import fetch from "node-fetch";

const app = express();

// 🔓 Omogoči CORS, da Stremio lahko dostopa do manifesta in rezultatov
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

// ⚙️ Render določi port sam
const PORT = process.env.PORT;

// 🔐 Prijavni podatki za podnapisi.net
const PODNAPISI_USER = "patagero";
const PODNAPISI_PASS = "Formio1978";

// 🧠 Glavna funkcija za iskanje slovenskih podnapisov
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  const browser = await puppeteer.launch({
    args: chromium.args,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
    defaultViewport: chromium.defaultViewport,
  });

  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(40000);

  try {
    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/login", { waitUntil: "domcontentloaded" });
    await page.type('input[name="username"]', PODNAPISI_USER, { delay: 50 });
    await page.type('input[name="password"]', PODNAPISI_PASS, { delay: 50 });
    await Promise.all([
      page.click('button[type="submit"]'),
      page.waitForNavigation({ waitUntil: "networkidle0", timeout: 30000 }),
    ]);
    console.log("✅ Prijava uspešna");

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
    console.log(`🌍 Iskanje: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

    try {
      await page.waitForSelector(".subtitle-entry", { timeout: 10000 });
    } catch {
      console.log("⚠️ Elementi niso bili pravočasno naloženi – nadaljujem.");
    }

    const subtitles = await page.$$eval(".subtitle-entry", (rows) =>
      rows.map((r) => {
        const name = r.querySelector(".release")?.textContent?.trim() || "Neznan";
        const link = r.querySelector("a[href*='/sl/subtitles/']")?.href || null;
        const lang = r.querySelector(".language")?.textContent?.trim() || "";
        return { name, link, lang };
      })
    );

    const slSubs = subtitles.filter((s) => s.lang.toLowerCase().includes("slovenski"));
    console.log(`✅ Najdenih ${slSubs.length} slovenskih podnapisov`);

    await browser.close();
    return slSubs;
  } catch (err) {
    console.error("❌ Napaka pri scrapanju:", err);
    await browser.close();
    return [];
  }
}

// 📜 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "10.1.4",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Samodejni iskalnik slovenskih podnapisov s portala Podnapisi.NET (Render-safe)",
    types: ["movie"],
    resources: [
      {
        name: "subtitles",
        types: ["movie"],
        idPrefixes: ["tt"]
      }
    ],
    catalogs: [],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  });
});

// 🎬 Endpoint za iskanje podnapisov
app.get("/subtitles/movie/:query.json", async (req, res) => {
  const query = req.params.query;
  console.log(`🎬 Prejemam zahtevo za: ${query}`);

  try {
    const subtitles = await scrapeSubtitlesByTitle(query);
    res.json({
      subtitles: subtitles.map((s) => ({
        id: s.link,
        lang: "sl",
        url: s.link,
        name: s.name
      }))
    });
  } catch (err) {
    console.error("❌ Napaka pri obdelavi zahteve:", err);
    res.json({ subtitles: [] });
  }
});

// 🩺 Health check
app.get("/health", (_, res) => res.send("✅ OK"));

// 🔁 Root → manifest
app.get("/", (_, res) => res.redirect("/manifest.json"));

// 🚀 Zagon strežnika
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v10.1.4 posluša na portu ${PORT}`);
  console.log("==================================================");
});
