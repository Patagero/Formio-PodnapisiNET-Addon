import express from "express";
import cors from "cors";
import cheerio from "cheerio";
import unzipper from "unzipper";

const app = express();
app.use(cors());

// Render/Heroku style port binding
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// ---- Basic in-memory cache (good enough for Render free tier)
const cache = {
  // key -> { vtt, ts }
  files: new Map(),
  // key -> { results, ts }
  searches: new Map()
};

const CACHE_TTL_MS = 1000 * 60 * 30; // 30 min

function now() {
  return Date.now();
}
function cacheGet(map, key) {
  const v = map.get(key);
  if (!v) return null;
  if (now() - v.ts > CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return v;
}
function cacheSet(map, key, value) {
  map.set(key, { ...value, ts: now() });
}

// ---- Helpers
function safeJson(obj) {
  return JSON.stringify(obj, null, 2);
}

function normalizeLang(lang) {
  // Stremio uses ISO639-2 in many clients, but can accept ISO639-1 too.
  // We'll return ISO639-2 where we can.
  const l = (lang || "").toLowerCase();
  const map = {
    sl: "slv",
    slovene: "slv",
    slv: "slv",
    en: "eng",
    eng: "eng",
    english: "eng",
    hr: "hrv",
    hrv: "hrv",
    croatian: "hrv",
    sr: "srp",
    srp: "srp",
    serbian: "srp",
    bs: "bos",
    bos: "bos",
    bosnian: "bos",
    it: "ita",
    ita: "ita",
    de: "deu",
    deu: "deu",
    german: "deu",
    fr: "fra",
    fra: "fra",
    es: "spa",
    spa: "spa"
  };
  return map[l] || (l.length === 3 ? l : l);
}

// Minimal SRT -> VTT converter
function srtToVtt(srtText) {
  // Replace commas in timestamps, ensure proper header
  // Also strip any weird \r
  const body = srtText
    .replace(/\r/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");

  // Ensure WEBVTT header
  return `WEBVTT\n\n${body}`.trim() + "\n";
}

function pickBestTitle(meta) {
  // Prefer name, then original, then fallback
  return (meta?.name || meta?.title || meta?.originalTitle || meta?.original || "").toString().trim();
}

function parseImdbFromStremioId(id) {
  // Typical Stremio meta IDs:
  // - tt0120338
  // - movie:tt0120338
  // - series:tt0903747
  if (!id) return null;
  const m = id.match(/tt\d{7,8}/);
  return m ? m[0] : null;
}

// ---- Podnapisi scraping logic
// NOTE: Podnapisi.NET HTML can change; this is “best effort” but works on the common layout.
const PODNAPISI_BASE = "https://www.podnapisi.net";

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; StremioPodnapisiAddon/1.0; +https://stremio.com/)",
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      ...opts.headers
    },
    ...opts
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

async function fetchBuffer(url, opts = {}) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; StremioPodnapisiAddon/1.0; +https://stremio.com/)",
      ...opts.headers
    },
    ...opts
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function buildSearchUrl({ query, imdb, year, lang }) {
  // We’ll use advanced-ish query params that usually work:
  // /subtitles/search/advanced?keywords=Titanic&year=1997&language=slv
  // Some params might be ignored by site; we still provide them.
  const u = new URL(PODNAPISI_BASE + "/subtitles/search/advanced");
  if (query) u.searchParams.set("keywords", query);
  if (year) u.searchParams.set("year", String(year));
  if (lang) u.searchParams.set("language", lang);

  // If imdb exists, try also as keyword (site often recognizes tt#######)
  if (imdb) {
    // Some times best results with imdb alone:
    // If query missing, set keywords to imdb
    if (!query) u.searchParams.set("keywords", imdb);
    // Or add imdb into keyword string
    else u.searchParams.set("keywords", `${query} ${imdb}`);
  }

  // Sorting: newest first, if supported
  u.searchParams.set("sort", "downloads");
  return u.toString();
}

function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const results = [];

  // Podnapisi pages typically have entries/cards with download buttons/links.
  // We'll look for anchors that include '/subtitles/' and '/download'
  // and then climb up to extract language and title-ish info.
  const seen = new Set();

  $("a").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    // Download links can be relative or absolute; we normalize later
    const isDownload = href.includes("/download") && href.includes("/subtitles/");
    if (!isDownload) return;

    const abs = href.startsWith("http") ? href : PODNAPISI_BASE + href;
    if (seen.has(abs)) return;
    seen.add(abs);

    // Try to get some context around this link
    const row = $(a).closest("tr, .subtitle, .card, .list-group-item, .row").first();

    const textBlob = row.text().replace(/\s+/g, " ").trim();

    // Try to detect language from common abbreviations in the blob
    // (This is heuristic; we also allow "unknown")
    let lang = "unknown";
    const langMap = [
      ["Slovenian", "slv"],
      ["Slovene", "slv"],
      ["SLO", "slv"],
      ["slv", "slv"],
      ["English", "eng"],
      ["eng", "eng"],
      ["Croatian", "hrv"],
      ["hrv", "hrv"],
      ["Serbian", "srp"],
      ["srp", "srp"],
      ["Bosnian", "bos"],
      ["bos", "bos"],
      ["Italian", "ita"],
      ["ita", "ita"],
      ["German", "deu"],
      ["deu", "deu"],
      ["French", "fra"],
      ["fra", "fra"],
      ["Spanish", "spa"],
      ["spa", "spa"]
    ];
    for (const [needle, code] of langMap) {
      if (textBlob.toLowerCase().includes(needle.toLowerCase())) {
        lang = code;
        break;
      }
    }

    // Pull a nicer title if possible
    let title =
      row.find("a[href*='/subtitles/']").first().text().replace(/\s+/g, " ").trim() ||
      $(a).text().replace(/\s+/g, " ").trim() ||
      "Podnapisi subtitle";

    if (!title || title.length < 2) title = "Podnapisi subtitle";

    results.push({
      downloadUrl: abs,
      title,
      lang,
      textBlob
    });
  });

  return results;
}

async function podnapisiSearch({ query, imdb, year, preferredLangs }) {
  const langsToTry = (preferredLangs?.length ? preferredLangs : ["slv", "eng"])
    .map(normalizeLang)
    .filter(Boolean);

  // Cache key based on inputs
  const cacheKey = JSON.stringify({ query, imdb, year, langsToTry });
  const cached = cacheGet(cache.searches, cacheKey);
  if (cached) return cached.results;

  const all = [];
  for (const lang of langsToTry) {
    const url = buildSearchUrl({ query, imdb, year, lang });
    const html = await fetchText(url);
    const parsed = parseSearchResults(html);

    // If parser didn’t detect language, we set it to the lang we searched
    const normalized = parsed.map((r) => ({
      ...r,
      lang: r.lang === "unknown" ? lang : r.lang
    }));

    all.push(...normalized);
  }

  // De-duplicate by downloadUrl
  const dedup = [];
  const seen = new Set();
  for (const r of all) {
    if (seen.has(r.downloadUrl)) continue;
    seen.add(r.downloadUrl);
    dedup.push(r);
  }

  // Keep a reasonable limit
  const results = dedup.slice(0, 30);

  cacheSet(cache.searches, cacheKey, { results });
  return results;
}

async function downloadAndExtractSrt(downloadUrl) {
  // Podnapisi download is typically a ZIP containing .srt (sometimes multiple)
  const zipBuf = await fetchBuffer(downloadUrl);

  const dir = await unzipper.Open.buffer(zipBuf);

  // Find first .srt (prefer largest file if multiple)
  const srtFiles = dir.files
    .filter((f) => !f.path.endsWith("/") && f.path.toLowerCase().endsWith(".srt"))
    .sort((a, b) => (b.uncompressedSize || 0) - (a.uncompressedSize || 0));

  if (!srtFiles.length) {
    // Sometimes it can be .sub/.txt; we can extend later if needed
    throw new Error("ZIP ne vsebuje .srt datoteke.");
  }

  const srtBuffer = await srtFiles[0].buffer();
  // Most SRTs are UTF-8, but some might be Windows-1250; we keep it simple UTF-8.
  // If you naletiš na šumnike zgrešene, dodamo iconv-lite + heuristiko.
  return srtBuffer.toString("utf-8");
}

// ---- Stremio endpoints
app.get("/", (req, res) => {
  res.type("text/plain").send(
    [
      "Podnapisi.NET Stremio addon is running.",
      "Try: /manifest.json",
      "Then install via: stremio://<your-url>/manifest.json"
    ].join("\n")
  );
});

app.get("/manifest.json", (req, res) => {
  const manifest = {
    id: "community.podnapisi.net.subtitles",
    version: "1.0.0",
    name: "Podnapisi.NET Subtitles (no browser)",
    description: "Subtitles from Podnapisi.NET (scrape + zip extract, no puppeteer).",
    resources: ["subtitles"],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: ["tt", "movie:tt", "series:tt"],
    behaviorHints: {
      configurable: true,
      configurationRequired: false
    }
  };

  res.json(manifest);
});

app.get("/subtitles/:type/:id.json", async (req, res) => {
  try {
    const { type, id } = req.params;

    const imdb = parseImdbFromStremioId(id);
    const q = (req.query.q || "").toString().trim(); // optional query from user
    const year = (req.query.year || "").toString().trim();
    const langs = (req.query.langs || "").toString().trim(); // e.g. "slv,eng"

    const preferredLangs = langs
      ? langs.split(",").map((s) => s.trim()).filter(Boolean)
      : ["slv", "eng"];

    // We need some query term; Stremio usually doesn't send it, so:
    // - Prefer explicit ?q=...
    // - Else try imdb only (often works)
    const query = q || (imdb ? "" : "");

    const results = await podnapisiSearch({
      query,
      imdb,
      year: year ? Number(year) : undefined,
      preferredLangs
    });

    const subtitles = results.map((r, idx) => {
      // We don't want to expose Podnapisi download URL directly to Stremio (CORS, zip),
      // so we serve a VTT from our endpoint.
      const fileId = Buffer.from(r.downloadUrl).toString("base64url");

      return {
        id: `podnapisi:${fileId}:${idx}`,
        lang: r.lang,
        // Important: Stremio expects a direct file URL
        url: `${BASE_URL}/file/${fileId}.vtt`,
        // Extra hint shown by some clients
        title: r.title
      };
    });

    res.json({ subtitles });
  } catch (err) {
    res.status(500).json({
      subtitles: [],
      error: String(err?.message || err)
    });
  }
});

app.get("/file/:fileId.vtt", async (req, res) => {
  try {
    const { fileId } = req.params;

    const cached = cacheGet(cache.files, fileId);
    if (cached?.vtt) {
      res.type("text/vtt").send(cached.vtt);
      return;
    }

    const downloadUrl = Buffer.from(fileId, "base64url").toString("utf-8");
    if (!downloadUrl.startsWith(PODNAPISI_BASE)) {
      throw new Error("Neveljaven download URL.");
    }

    const srt = await downloadAndExtractSrt(downloadUrl);
    const vtt = srtToVtt(srt);

    cacheSet(cache.files, fileId, { vtt });

    res.type("text/vtt").send(vtt);
  } catch (err) {
    res.status(500).type("text/plain").send(`Napaka: ${String(err?.message || err)}`);
  }
});

app.listen(PORT, () => {
  console.log(`🔥 ADDON RUNNING ON ${PORT}`);
  console.log(`Manifest: ${BASE_URL}/manifest.json`);
});
