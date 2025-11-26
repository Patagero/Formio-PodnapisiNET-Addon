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
  version: "10.0.0",
  name: "Formio Podnapisi.NET 🇸🇮 (Final Version – Movies + Series + ZIP Fix)",
  description: "Slovenski podnapisi: filmi + serije + ZIP → SRT extractor (new Podnapisi layout).",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// ---- Parse series format (tt1234567:season:episode) ----------------------
function parseSeries(imdb) {
  const parts = imdb.split(":");
  return {
    id: parts[0],
    season: parts[1] || null,
    episode: parts[2] || null
  };
}

// ---- IMDb title lookup ---------------------------------------------------
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
  } catch (e) { console.log("IMDb error", e); }
  return imdbId;
}

// ---- Episode matching ----------------------------------------------------
function matchesEpisode(name, season, episode) {
  if (!season || !episode) return true;

  const s = season.padStart(2, "0");
  const e = episode.padStart(2, "0");
  const n = name.toLowerCase();

  const patterns = [
    `s${s}e${e}`,
    `season ${season} episode ${episode}`,
    `${season}x${episode}`,
    `${season}.${episode}`,
    `ep ${episode}`,
    `episode ${episode}`
  ];

  return patterns.some(p => n.includes(p.toLowerCase()));
}

// ---- Podnapisi scraper ---------------------------------------------------
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

  // NEW layout
  $(".media").each((i, el) => {
    const a = $(el).find("a[href*='/sl/subtitles/']").first();
    const href = a.attr("href");
    let name = a.text().trim();

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

  // OLD layout fallback
  if (results.length === 0) {
    $("table.table tbody tr").each((i, row) => {
      const a = $(row).find("a[href*='subtitles']").first();
      const href = a.attr("href");
      const name = a.text().trim();

      if (!href) return;

      const full = href.startsWith("http")
        ? href
        : `https://www.podnapisi.net${href}`;

      if (!seen.has(full) && matchesEpisode(name, season, episode)) {
        results.push({
          id: `slo-${results.length + 1}`,
          lang: "sl",
          url: `/download?url=${encodeURIComponent(full)}`,
          title: `${name} 🇸🇮`
        });
      }

      seen.add(full);
    });
  }

  console.log(`➡️ Najdenih ${results.length} podnapisov (po S/E filtru)`);
  return results;
}

// =======================================================================
//      ⭐ NEW: FINAL FIXED ZIP EXTRACTOR (WORKS FOR NEW PODNAPISI SITE)
// =======================================================================
app.get("/download", async (req, res) => {
  try {
    const pageUrl = req.query.url;
    if (!pageUrl) return res.status(400).send("Missing url");

    console.log("⬇️ STEP 1: Fetch HTML page:", pageUrl);

    // 1) Fetch the HTML page (not ZIP!)
    const pageRes = await fetch(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "sl,en;q=0.9"
      }
    });

    const html = await pageRes.text();
    const $ = cheerio.load(html);

    // 2) Extract the REAL ZIP URL
    let zipHref =
      $('a[href*="/download"]').attr("href") ||
      $('a[href*="download"]').attr("href");

    if (!zipHref) {
      console.log("❌ No zip link found in page");
      return res.status(404).send("ZIP link missing");
    }

    const zipUrl = zipHref.startsWith("http")
      ? zipHref
      : `https://www.podnapisi.net${zipHref}`;

    console.log("⬇️ STEP 2: Real ZIP URL:", zipUrl);

    // 3) Download ZIP
    const zipRes = await fetch(zipUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "sl,en;q=0.9"
      }
    });

    const zipBuffer = Buffer.from(await zipRes.arrayBuffer());

    // 4) Extract SRT from ZIP
    const zip = new AdmZip(zipBuffer);
    const srtEntry = zip
      .getEntries()
      .find(e => e.entryName.toLowerCase().endsWith(".srt"));

    if (!srtEntry) {
      console.log("❌ ZIP found but contains no .srt");
      return res.status(404).send("ZIP without SRT");
    }

    const srtText = srtEntry.getData().toString("utf8");

    res.setHeader("Content-Type", "application/x-subrip");
    res.send(srtText);

  } catch (err) {
    console.log("❌ DOWNLOAD ERROR:", err);
    res.status(500).send("ZIP/SRT extraction failed");
  }
});

// =======================================================================
//                         MAIN SUBTITLES ROUTE
// =======================================================================
app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  let imdbRaw = req.params.imdbId;

  let imdbId = imdbRaw;
  let season = null;
  let episode = null;

  if (imdbRaw.includes(":")) {
    const parsed = parseSeries(imdbRaw);
    imdbId = parsed.id;
    season = parsed.season;
    episode = parsed.episode;
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

app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/", (req, res) => res.redirect("/manifest.json"));

// Start
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(" FORMIO PODNAPISI.NET 🇸🇮 — FINAL VERSION (FULL SUPPORT)");
  console.log("==================================================");
});
