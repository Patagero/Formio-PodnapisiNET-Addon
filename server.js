import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

// Manifest za Stremio
const manifest = {
  id: "org.formio.podnapisi",
  version: "7.0.0",
  name: "Formio Podnapisi.NET 🇸🇮 (lite)",
  description: "Stabilna verzija brez Puppeteer – samo slovenski podnapisi",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// IMDb -> naslov (preko OMDb, kot prej)
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`
    );
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → ${data.Title} (${data.Year})`);
      return data.Title.trim();
    }
  } catch (err) {
    console.log("⚠️ Napaka IMDb API:", err.message);
  }
  return imdbId;
}

// HTML scraping Podnapisi.net brez login-a (samo slovenski)
async function searchSlovenianSubtitles(imdbId) {
  const title = await getTitleFromIMDb(imdbId);
  console.log(`🎯 Iščem podnapise za: ${title}`);

  const searchUrl =
    "https://www.podnapisi.net/sl/subtitles/search/?" +
    `keywords=${encodeURIComponent(title)}&language=sl`;

  console.log("🌍 URL:", searchUrl);

  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Accept-Language": "sl,en;q=0.8"
    }
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];

  $("table.table tbody tr").each((i, row) => {
    const $row = $(row);

    // Link do podnapisov (download/subtitles)
    const a =
      $row.find("a[href*='/download']").first().attr("href") ||
      $row.find("a[href*='/subtitles/']").first().attr("href");

    const name = $row.find("a").first().text().trim();

    if (!a || !name) return;

    const url = a.startsWith("http")
      ? a
      : `https://www.podnapisi.net${a}`;

    results.push({
      id: `slo-${i + 1}`,
      lang: "sl",
      url,
      title: `${name} 🇸🇮`
    });
  });

  console.log(`✅ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// Manifest route
app.get("/manifest.json", (_req, res) => {
  res.json(manifest);
});

// Glavni subtitles endpoint za Stremio
// npr. /subtitles/movie/tt0133093.json
app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;

  console.log("==================================================");
  console.log("🎬 IMDb Request:", imdbId);

  try {
    const subtitles = await searchSlovenianSubtitles(imdbId);
    res.json({ subtitles });
  } catch (err) {
    console.error("💥 Napaka pri iskanju podnapisov:", err);
    res.json({ subtitles: [] });
  }
});

app.get("/", (_req, res) => res.redirect("/manifest.json"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 LITE aktiven");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
