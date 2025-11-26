import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

// Manifest (Stremio)
const manifest = {
  id: "org.formio.podnapisi",
  version: "9.0.0",
  name: "Formio Podnapisi.NET 🇸🇮 (FILMI + SERIJE)",
  description: "Slovenski podnapisi – ZIP→SRT extractor – podpira filme in serije.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// --- PARSER ZA SERIJE ----------------------------------------------------
function parseSeries(imdb) {
  const [id, season, episode] = imdb.split(":");
  return {
    id,
    season: season ? String(season) : null,
    episode: episode ? String(episode) : null
  };
}

// --- IMDb TITLE FETCH ----------------------------------------------------
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
  } catch {}
  return imdbId;
}

// --- EPISODE MATCHER -----------------------------------------------------
function matchesEpisode(name, season, episode) {
  if (!season || !episode) return true; // ni serija, vrni vse

  const s = season.padStart(2, "0");
  const e = episode.padStart(2, "0");
  const lower = name.toLowerCase();

  const patterns = [
    `s${s}e${e}`,
    `s${season}e${episode}`,
    `${season}x${episode}`,
    `${season}.${episode}`,
    `season ${season} episode ${episode}`,
    `episode ${episode}`,
    `ep ${episode}`
  ];

  return patterns.some(p => lower.includes(p.toLowerCase()));
}

// --- PODNAPISI SCRAPER ---------------------------------------------------
async function searchSlovenianSubs(title, season = null, episode = null) {
  const searchUrl =
    "https://www.podnapisi.net/sl/subtitles/search/?" +
    `keywords=${encodeURIComponent(title)}&language=sl`;

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

  // 1️⃣ Novi layout ".media"
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

  // 2️⃣ Old layout fallback
  if (results.length === 0) {
    $("table.table tbody tr").each((i, row) => {
      const a = $(row)
        .find("a[href*='/download'], a[href*='/subtitles/']")
        .first();

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
  }

  // 3️⃣ Regex backup
  if (results.length === 0) {
    const regex = /href="([^"]*\/sl\/subtitles\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const full = match[1].startsWith("http")
        ? match[1]
        : `https://www.podnapisi.net${match[1]}`;
      const name = match[2].trim();

      if (seen.has(full)) continue;
      seen.add(full);

      if (!matchesEpisode(name, season, episode)) continue;

      results.push({
        id: `slo-${results.length + 1}`,
        lang: "sl",
        url: `/download?url=${encodeURIComponent(full)}`,
        title: `${name} 🇸🇮`
      });
    }
  }

  console.log(`➡️ Najdenih ${results.length} podnapisov (po filtriranju S/E)`);
  return results;
}

// --- ZIP → SRT Extractor ----------------------------------------------------
app.get("/download", async (req, res) => {
  try {
    const fileUrl = req.query.url;
    if (!fileUrl) return res.status(400).send("Missing url");

    console.log("⬇️ Fetching ZIP:", fileUrl);

    const r = await fetch(fileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "sl,en;q=0.9"
      }
    });

    const buf = Buffer.from(await r.arrayBuffer());
    const zip = new AdmZip(buf);
    const srt = zip
      .getEntries()
      .find(e => e.entryName.toLowerCase().endsWith(".srt"));

    if (!srt) return res.status(404).send("No SRT found");

    res.setHeader("Content-Type", "application/x-subrip");
    res.send(srt.getData().toString("utf8"));

  } catch (err) {
    console.log("❌ DOWNLOAD ERROR:", err);
    res.status(500).send("Error extracting SRT");
  }
});

// --- MAIN ROUTE -------------------------------------------------------------
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  let imdbRaw = req.params.imdbId;

  // SERIJA? (format tt1234567:season:episode)
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
  console.log(`🔎 Detected → imdbId=${imdbId}, S=${season}, E=${episode}`);

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

// --- START SERVER -----------------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(" FORMIO PODNAPISI.NET 🇸🇮 — FILMI + SERIJE + SRT READY");
  console.log("==================================================");
});
