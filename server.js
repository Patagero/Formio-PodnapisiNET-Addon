import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "7.2.0",
  name: "Formio Podnapisi.NET 🇸🇮 (LITE + BYPASS)",
  description: "Stabilna verzija brez Puppeteer, zanesljiv Cloudflare bypass + novi selektorji",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// IMDb → Title
async function getTitleFromIMDb(imdbId) {
  try {
    const r = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`
    );
    const d = await r.json();
    if (d?.Title) return d.Title;
  } catch (err) {
    console.log("IMDb error:", err.message);
  }
  return imdbId;
}

// Cloudflare bypass proxy endpoint
async function fetchBypass(url) {
  const endpoint = `https://api.bypass.vip/raw?url=${encodeURIComponent(url)}`;

  const res = await fetch(endpoint, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "sl,en;q=0.9"
    }
  });

  return await res.text();
}

// NEW + OLD Podnapisi HTML parsing
async function searchSlovenianSubs(imdbId) {
  const title = await getTitleFromIMDb(imdbId);
  const searchUrl =
    "https://www.podnapisi.net/sl/subtitles/search/?" +
    `keywords=${encodeURIComponent(title)}&language=sl`;

  console.log("🌍 SCRAPING VIA BYPASS:", searchUrl);

  const html = await fetchBypass(searchUrl);
  const $ = cheerio.load(html);

  const results = [];

  // NEW LAYOUT 2024+ (media cards)
  $(".media, .media-body, .media-heading").each((i, el) => {
    const a = $(el).find("a[href*='/download'], a[href*='/subtitles/']").first();
    const href = a.attr("href");
    const name = a.text().trim();

    if (!href || !name) return;

    const link = href.startsWith("http")
      ? href
      : `https://www.podnapisi.net${href}`;

    results.push({
      id: `slo-${results.length + 1}`,
      lang: "sl",
      url: link,
      title: `${name} 🇸🇮`
    });
  });

  // OLD LAYOUT (backup)
  if (results.length === 0) {
    $("table.table tbody tr").each((i, row) => {
      const a = $(row).find("a[href*='/download']").first();
      const href = a.attr("href");
      const name = a.text().trim();

      if (!href || !name) return;

      const link = href.startsWith("http")
        ? href
        : `https://www.podnapisi.net${href}`;

      results.push({
        id: `slo-${results.length + 1}`,
        lang: "sl",
        url: link,
        title: `${name} 🇸🇮`
      });
    });
  }

  // REGEX fallback (če vse ostalo ne uspe)
  if (results.length === 0) {
    const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push({
        id: `slo-${results.length + 1}`,
        lang: "sl",
        url: `https://www.podnapisi.net${match[1]}`,
        title: `${match[2].trim()} 🇸🇮`
      });
    }
  }

  console.log(`➡️ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// Routes
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;

  console.log("==================================================");
  console.log("🎬 IMDb Request:", imdbId);

  try {
    const subs = await searchSlovenianSubs(imdbId);
    res.json({ subtitles: subs });
  } catch (err) {
    console.log("💥 SCRAPE ERROR:", err);
    res.json({ subtitles: [] });
  }
});

app.get("/", (req, res) => res.redirect("/manifest.json"));

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("  Formio Podnapisi.NET LITE + BYPASS RUNNING");
  console.log("==================================================");
});
