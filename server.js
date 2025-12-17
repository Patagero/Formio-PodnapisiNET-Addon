import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";   // ← FIX: ESM-compatible import
import unzipper from "unzipper";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// ---- Simple cache
const cache = {
  files: new Map(),
  searches: new Map()
};

const CACHE_TTL_MS = 1000 * 60 * 30;

const now = () => Date.now();
const cacheGet = (map, key) => {
  const v = map.get(key);
  if (!v) return null;
  if (now() - v.ts > CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return v;
};
const cacheSet = (map, key, value) => {
  map.set(key, { ...value, ts: now() });
};

// ---- Helpers
const normalizeLang = (lang) => {
  const l = (lang || "").toLowerCase();
  const map = {
    sl: "slv", slv: "slv", slovene: "slv",
    en: "eng", eng: "eng", english: "eng",
    hr: "hrv", hrv: "hrv",
    sr: "srp", srp: "srp",
    bs: "bos", bos: "bos",
    it: "ita", ita: "ita",
    de: "deu", deu: "deu",
    fr: "fra", fra: "fra",
    es: "spa", spa: "spa"
  };
  return map[l] || l;
};

const parseImdbFromStremioId = (id) => {
  const m = id?.match(/tt\d{7,8}/);
  return m ? m[0] : null;
};

const srtToVtt = (srt) =>
  `WEBVTT\n\n${srt
    .replace(/\r/g, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
  }\n`;

const PODNAPISI_BASE = "https://www.podnapisi.net";

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "Stremio-Podnapisi-Addon" }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fetchBuffer(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "Stremio-Podnapisi-Addon" }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  $("a[href*='/download']").each((_, a) => {
    const href = $(a).attr("href");
    if (!href || !href.includes("/subtitles/")) return;

    const url = href.startsWith("http") ? href : PODNAPISI_BASE + href;
    if (seen.has(url)) return;
    seen.add(url);

    const row = $(a).closest("tr, .subtitle, .row, li");
    const text = row.text().toLowerCase();

    let lang = "eng";
    if (text.includes("slov")) lang = "slv";
    else if (text.includes("hrv") || text.includes("croat")) lang = "hrv";
    else if (text.includes("srp") || text.includes("serb")) lang = "srp";

    out.push({
      downloadUrl: url,
      lang,
      title: row.find("a").first().text().trim() || "Podnapisi"
    });
  });

  return out;
}

async function podnapisiSearch({ imdb, langs }) {
  const key = JSON.stringify({ imdb, langs });
  const cached = cacheGet(cache.searches, key);
  if (cached) return cached.results;

  let results = [];

  for (const l of langs) {
    const url = `${PODNAPISI_BASE}/subtitles/search/advanced?keywords=${imdb}&language=${l}`;
    const html = await fetchText(url);
    results.push(...parseSearchResults(html).map(r => ({ ...r, lang: l })));
  }

  cacheSet(cache.searches, key, { results });
  return results.slice(0, 20);
}

async function downloadSrt(downloadUrl) {
  const zip = await fetchBuffer(downloadUrl);
  const dir = await unzipper.Open.buffer(zip);
  const srtFile = dir.files.find(f => f.path.toLowerCase().endsWith(".srt"));
  if (!srtFile) throw new Error("No SRT in ZIP");
  return (await srtFile.buffer()).toString("utf-8");
}

// ---- Routes
app.get("/manifest.json", (_, res) => {
  res.json({
    id: "community.podnapisi.net.subtitles",
    version: "1.0.0",
    name: "Podnapisi.NET (no browser)",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

app.get("/subtitles/:type/:id.json", async (req, res) => {
  try {
    const imdb = parseImdbFromStremioId(req.params.id);
    const langs = (req.query.langs || "slv,eng")
      .split(",")
      .map(normalizeLang);

    const results = await podnapisiSearch({ imdb, langs });

    res.json({
      subtitles: results.map((r, i) => {
        const fid = Buffer.from(r.downloadUrl).toString("base64url");
        return {
          id: `podnapisi:${i}`,
          lang: r.lang,
          title: r.title,
          url: `${BASE_URL}/file/${fid}.vtt`
        };
      })
    });
  } catch {
    res.json({ subtitles: [] });
  }
});

app.get("/file/:id.vtt", async (req, res) => {
  try {
    const url = Buffer.from(req.params.id, "base64url").toString();
    const cached = cacheGet(cache.files, url);
    if (cached) return res.type("text/vtt").send(cached.vtt);

    const srt = await downloadSrt(url);
    const vtt = srtToVtt(srt);
    cacheSet(cache.files, url, { vtt });

    res.type("text/vtt").send(vtt);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

app.listen(PORT, () =>
  console.log(`🔥 Podnapisi addon running on ${PORT}`)
);
