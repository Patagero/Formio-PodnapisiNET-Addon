import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

// Manifest
const manifest = {
  id: "org.formio.podnapisi",
  version: "11.0.0",
  name: "Formio Podnapisi.NET 🇸🇮 (Movies + Series + Multi-Layout + ZIP→SRT)",
  description: "Stabilni slovenski podnapisi za filme in serije. Podpira nove in stare Podnapisi.net layout-e.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// Parse SxxEyy format
function parseSeries(imdb) {
  const [id, season, episode] = imdb.split(":");
  return { id, season: season || null, episode: episode || null };
}

// IMDb title lookup
async function getTitleFromIMDb(imdbId) {
  try {
    const r = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`
    );
    const d = await r.json();
    if (d?.Title) {
      console.log(`🎬 IMDb: ${imdbId} → ${d.Title}`);
      return d.Title;
    }
  } catch (e) {
    console.log("IMDb error:", e);
  }
  return imdbId;
}

// Episode matching
function matchesEpisode(name, season, episode) {
  if (!season || !episode) return true;

  const s = season.padStart(2, "0");
  const e = episode.padStart(2, "0");
  const low = name.toLowerCase();

  const patterns = [
    `s${s}e${e}`,
    `season ${season} episode ${episode}`,
    `${season}x${episode}`,
    `${season}.${episode}`,
    `ep ${episode}`,
    `episode ${episode}`,
    `${s}${e}`, // some use S1E1 without letters
  ];

  return patterns.some(p => low.includes(p.toLowerCase()));
}

// Podnapisi scraper
async function searchSlovenianSubs(title, season, episode) {
  const searchUrl =
    `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;

  console.log("🌍 SCRAPING:", searchUrl);

  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "sl,en;q=0.8"
    }
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  // ---- MULTI-LAYOUT SELECTORS FOR FILMS + SERIES ----
  const selectors = [
    ".media a[href*='/sl/subtitles/']",
    ".subtitle-entry a[href*='/sl/subtitles/']",
    ".release a[href*='/sl/subtitles/']",
    ".list-group-item a[href*='/sl/subtitles/']",
    ".card a[href*='/sl/subtitles/']",
    "a[href*='/sl/subtitles/']",     // final safety fallback
  ];

  selectors.forEach(sel => {
    $(sel).each((i, a) => {
      const href = $(a).attr("href");
      let name = $(a).text().trim();

      if (!href) return;

      const full = href.startsWith("http")
        ? href
        : `https://www.podnapisi.net${href}`;

      if (seen.has(full)) return;
      seen.add(full);

      if (!name) name = "Podnapisi";

      if (!matchesEpisode(name, season, episode)) return;

      results.push({
        id: `slo-${results.length + 1}`,
        lang: "sl",
        url: `/download?url=${encodeURIComponent(full)}`,
        title: `${name} 🇸🇮`
      });
    });
  });

  console.log(`➡️ Najdenih ${results.length} podnapisov (po serijskem filtru)`);
  return results;
}

// ZIP → SRT extractor (2-step)
app.get("/download", async (req, res) => {
  try {
    const pageUrl = req.query.url;
    if (!pageUrl) return res.status(400).send("Missing url");

    console.log("⬇️ STEP 1: Fetch HTML:", pageUrl);

    const pageRes = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "sl,en;q=0.9"
      }
    });

    const html = await pageRes.text();
    const $ = cheerio.load(html);

    let zipHref =
      $('a[href*="/download"]').attr("href") ||
      $('a[href*="download"]').attr("href");

    if (!zipHref) {
      console.log("❌ ZIP not found in HTML page");
      return res.status(404).send("ZIP link missing");
    }

    const zipUrl = zipHref.startsWith("http")
      ? zipHref
      : `https://www.podnapisi.net${zipHref}`;

    console.log("⬇️ STEP 2: Fetch ZIP:", zipUrl);

    const zipRes = await fetch(zipUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "sl,en;q=0.9"
      }
    });

    const zipBuf = Buffer.from(await zipRes.arrayBuffer());

    const zip = new AdmZip(zipBuf);
    const srtEntry = zip
      .getEntries()
      .find(e => e.entryName.toLowerCase().endsWith(".srt"));

    if (!srtEntry) {
      console.log("❌ ZIP found but no SRT inside");
      return res.status(404).send("No SRT in ZIP");
    }

    const srtText = srtEntry.getData().toString("utf8");
    res.setHeader("Content-Type", "application/x-subrip");
    res.send(srtText);

  } catch (err) {
    console.log("❌ DOWNLOAD ERROR:", err);
    res.status(500).send("ZIP/SRT extraction failed");
  }
});

// Subtitles route
app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbRaw = req.params.imdbId;

  let imdbId = imdbRaw;
  let season = null;
  let episode = null;

  if (imdbRaw.includes(":")) {
    const p = parseSeries(imdbRaw);
    imdbId = p.id;
    season = p.season;
    episode = p.episode;
  }

  console.log("==================================================");
  console.log("🎬 Request:", imdbRaw);
  console.log(`🔎 Parsed → imdbId=${imdbId}, S=${season}, E=${episode}`);

  try {
    const title = await getTitleFromIMDb(imdbId);
    const subs = await searchSlovenianSubs(title, season, episode);

    const base = "https://formio-podnapisinet-addon-1.onrender.com";
    subs.forEach(s => (s.url = `${base}${s.url}`));

    res.json({ subtitles: subs });

  } catch (err) {
    console.log("💥 ERROR:", err);
    res.json({ subtitles: [] });
  }
});

app.get("/", (req, res) => res.redirect("/manifest.json"));
app.get("/manifest.json", (req, res) => res.json(manifest));

// Start server
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(" FORMIO PODNAPISI.NET 🇸🇮 — FINAL VERSION FOR MOVIES + SERIES");
  console.log("==================================================");
});
