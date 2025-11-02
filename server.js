import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

// 📄 Manifest
const manifest = {
  id: "org.formio.podnapisi",
  version: "1.2.0",
  name: "Formio Podnapisi.NET",
  description: "Samodejno pridobiva slovenske podnapise iz podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// 📜 Manifest
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

// 🎬 Glavna pot za podnapise
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  const query = id.replace("tt", "");
  const lang = "sl";

  console.log(`🔍 Iščem podnapise za: ${query}`);

  try {
    const searchUrl = `https://www.podnapisi.net/en/subtitles/search/?keywords=${encodeURIComponent(query)}&language=${lang}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"
      }
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    // Poiščemo vse vrstice, kjer obstaja povezava na "/download"
    let downloadLinks = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (href && href.includes("/download") && href.startsWith("/en/subtitles")) {
        downloadLinks.push(href);
      }
    });

    if (downloadLinks.length === 0) {
      console.log("⚠️  Ni bilo najdenih povezav v HTML-ju.");
      return res.json({ subtitles: [] });
    }

    // Prvi najdeni prenos
    const downloadUrl = "https://www.podnapisi.net" + downloadLinks[0];
    console.log(`✅ Najden prenos: ${downloadUrl}`);

    const subtitles = [
      {
        id: "formio-podnapisi",
        url: downloadUrl,
        lang: "sl",
        name: "Formio Podnapisi.NET"
      }
    ];

    res.json({ subtitles });
  } catch (err) {
    console.error("❌ Napaka:", err.message);
    res.json({ subtitles: [] });
  }
});

// 🚀 Zaženi strežnik
const PORT = process.env.PORT || 7760;
const HOST = "0.0.0.0";

app.listen(PORT, HOST, () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
