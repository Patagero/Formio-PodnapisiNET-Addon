import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "7.1.0",
  name: "Formio Podnapisi.NET 🇸🇮 (LITE + Bypass)",
  description: "Stabilna verzija brez Puppeteer, zanesljiv Cloudflare bypass",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// IMDB → Title
async function getTitleFromIMDb(imdbId) {
  try {
    const r = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`
    );
    const d = await r.json();
    if (d?.Title) return d.Title;
  } catch {}
  return imdbId;
}

// Cloudflare bypass fetch
async function fetchBypass(url) {
  const full = `https://api.bypass.vip/raw?url=${encodeURIComponent(url)}`;
  const res = await fetch(full);
  return await res.text();
}

// Search subtitles (lite)
async function searchSlovenianSubs(imdbId) {
  const title = await getTitleFromIMDb(imdbId);

  const searchUrl =
    "https://www.podnapisi.net/sl/subtitles/search/?" +
    `keywords=${encodeURIComponent(title)}&language=sl`;

  console.log("🌍 SCRAPING VIA BYPASS:", searchUrl);

  const html = await fetchBypass(searchUrl);
  const $ = cheerio.load(html);

  const results = [];

  $("table.table tbody tr").each((i, row) => {
    const a = $(row).find("a[href*='/download'], a[href*='/subtitles/']").first();
    const href = a.attr("href");
    const name = a.text().trim();

    if (!href || !name) return;

    const link = href.startsWith("http")
      ? href
      : `https://www.podnapisi.net${href}`;

    results.push({
      id: `slo-${i + 1}`,
      lang: "sl",
      url: link,
      title: `${name} 🇸🇮`
    });
  });

  console.log(`➡️ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// Routes
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;

  try {
    const subs = await searchSlovenianSubs(imdbId);
    res.json({ subtitles: subs });
  } catch (err) {
    console.log("💥 Error:", err);
    res.json({ subtitles: [] });
  }
});

app.get("/", (req, res) => res.redirect("/manifest.json"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("  Formio Podnapisi.NET LITE + BYPASS Running");
  console.log("==================================================");
});
