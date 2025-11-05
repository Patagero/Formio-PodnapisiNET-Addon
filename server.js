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
    description: "Slovenski podnapisi za Stremio (Render-safe)",
    types: ["movie"],
    resources: ["subtitles"],
    idPrefixes: ["tt"],
  });
});

// === Subtitles route ===
app.get("/subtitles/movie/:imdbId.json", async (req, res) => {
  const { imdbId } = req.params;
  console.log(`🎬 Prejemam zahtevo za IMDb: ${imdbId}`);

  let browser;
  let replied = false;

  // ⏰ Timeout varovalo — če Puppeteer zmrzne
  const timeout = setTimeout(() => {
    if (!replied) {
      replied = true;
      console.error("⚠️ Timeout: Puppeteer se ni zagnal pravočasno.");
      res.json({ imdbId, subtitles: [], status: "timeout" });
    }
  }, 20000); // 20 sekund

  try {
    console.log("🚀 Zaganjam Chromium...");

    const executablePath = await chromium.executablePath();
    console.log("📁 Chromium pot:", executablePath);

    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--single-process",
        "--disable-dev-shm-usage",
      ],
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
      userDataDir: "/tmp/puppeteer",
      timeout: 30000,
    });

    console.log("✅ Chromium zagnan!");

    const page = await browser.newPage();
    await page.goto("https://www.podnapisi.net", { waitUntil: "domcontentloaded" });

    // 💡 Tu bo kasneje scraping logika; zdaj samo testni odziv:
    if (!replied) {
      replied = true;
      clearTimeout(timeout);
      res.json({
        imdbId,
        subtitles: [],
        status: "OK (Chromium launched)",
      });
      console.log(`✅ Zahteva ${imdbId} uspešno zaključena.`);
    }
  } catch (err) {
    console.error("❌ Puppeteer napaka:", err);
    if (!replied) {
      replied = true;
      clearTimeout(timeout);
      res.status(500).json({ error: err.message });
    }
  } finally {
    if (browser) {
      try {
        await browser.close();
        console.log("🧹 Chromium zaprt.");
      } catch (closeErr) {
        console.error("⚠️ Napaka pri zapiranju brskalnika:", closeErr);
      }
    }
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
