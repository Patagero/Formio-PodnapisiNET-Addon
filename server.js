import express from "express";
import cors from "cors";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());

// === Manifest route ===
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "formio.podnapisinet.si",
    version: "1.0.0",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Slovenski podnapisi za Stremio",
    types: ["movie"],
    resources: ["subtitles"],
    idPrefixes: ["tt"],
  });
});

// === Sample subtitles route (test) ===
app.get("/subtitles/movie/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

  let browser;
  try {
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--single-process",
        "--disable-dev-shm-usage",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
      userDataDir: "/tmp/puppeteer",
    });

    const page = await browser.newPage();
    await page.goto("https://www.podnapisi.net", { waitUntil: "domcontentloaded" });

    // Tu bo kasneje tvoj scraping del — za zdaj pošljemo testni JSON:
    res.json({
      imdbId,
      subtitles: [],
      status: "OK",
    });
  } catch (err) {
    console.error("❌ Puppeteer napaka:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// === Start server ===
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 aktiven (Render-safe Chromium)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
