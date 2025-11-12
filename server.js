import express from "express";
import puppeteer from "puppeteer";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());

// 📜 Manifest route
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "com.formio.podnapisinet",
    version: "10.0.8",
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

// 🎬 Endpoint za iskanje podnapisov
app.get("/subtitles/movie/:query.json", async (req, res) => {
  const query = req.params.query;
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${query}`);

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();

    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/login", { waitUntil: "networkidle2" });
    await page.type("#username", "patagero");
    await page.type("#password", "Formio1978");
    await Promise.all([
      page.click("button[type=submit]"),
      page.waitForNavigation({ waitUntil: "networkidle2" }),
    ]);
    console.log("✅ Prijava uspešna");

    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(query)}&language=sl`;
    console.log(`🌍 Iskanje: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    const subtitles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".subtitle-entry")).map((el) => ({
        title: el.querySelector(".release")?.innerText?.trim() || "Neznan",
        lang: el.querySelector(".flags img")?.alt || "unknown",
        link: el.querySelector("a[href*='/sl/subtitles/']")?.href || null,
      }));
    });

    const slSubtitles = subtitles.filter(
      (s) => s.lang.toLowerCase().includes("sloven") && s.link
    );

    console.log(`✅ Najdenih ${slSubtitles.length} slovenskih podnapisov`);
    await browser.close();
    res.json(slSubtitles);
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err);
    res.json({ error: "scrape_failed", message: err.message });
  }
});

// 🔁 Root redirect
app.get("/", (req, res) => res.redirect("/manifest.json"));

// 🧠 Keep-alive ping (da Render ne zaspi)
setInterval(async () => {
  try {
    const url = `https://formio-podnapisinet-addon-1.onrender.com/manifest.json`;
    const ping = await fetch(url);
    console.log(`💓 Keep-alive ping (${ping.status})`);
  } catch (e) {
    console.log("⚠️ Keep-alive ping failed:", e.message);
  }
}, 5 * 60 * 1000); // vsakih 5 minut

// 🚀 Start server
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 v10.0.8 posluša na portu ${PORT}`);
  console.log("==================================================");
});
