import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import unzipper from "unzipper";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const BASE_URL =
  process.env.PUBLIC_URL || `http://localhost:${PORT}`;

const PODNAPISI_BASE = "https://www.podnapisi.net";

/* ================= CACHE ================= */
const CACHE_TTL = 1000 * 60 * 30;
const cache = {
  search: new Map(),
  files: new Map()
};

const now = () => Date.now();
const cacheGet = (map, k) => {
  const v = map.get(k);
  if (!v) return null;
  if (now() - v.ts > CACHE_TTL) {
    map.delete(k);
    return null;
  }
  return v.val;
};
const cacheSet = (map, k, v) =>
  map.set(k, { ts: now(), val: v });

/* ================= HELPERS ================= */
const parseImdb = (id) => {
  const m = id?.match(/tt\d{7,8}/);
  return m ? m[0] : null;
};

const srtToVtt = (srt) =>
  `WEBVTT\n\n${srt
    .replace(/\r/g, "")
    .replace(
      /(\d{2}:\d{2}:\d{2}),(\d{3})/g,
      "$1.$2"
    )}\n`;

async function fetchText(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "Stremio-Podnapisi" }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function fetchBuffer(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "Stremio-Podnapisi" }
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ================= PARSER (FIXED) ================= */
function parseSearchResults(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();

  $("table tbody tr").each((_, tr) => {
    const row = $(tr);

    const dl = row
      .find('a[href$="/download"]')
      .attr("href");
    if (!dl) return;

    const downloadUrl = dl.startsWith("http")
      ? dl
      : PODNAPISI_BASE + dl;

    if (seen.has(downloadUrl)) return;
    seen.add(downloadUrl);

    const title =
      row.find("td.title a").first().text().trim() ||
      "Podnapisi.NET";

    let lang = "eng";
    const langTitle =
      row.find("td.language img").attr("title") || "";

    if (/slov/i.test(langTitle)) lang = "slv";
    else if (/hrv|croat/i.test(langTitle)) lang = "hrv";
    else if (/serb/i.test(langTitle)) lang = "srp";
    else if (/bos/i.test(langTitle)) lang = "bos";
    else if (/ital/i.test(langTitle)) lang = "ita";
    else if (/germ/i.test(langTitle)) lang = "deu";

    out.push({ downloadUrl, title, lang });
  });

  return out;
}

/* ================= SEARCH ================= */
async function podnapisiSearch(imdb) {
  const cached = cacheGet(cache.search, imdb);
  if (cached) return cached;

  let results = [];

  // 1️⃣ advanced
  const advUrl =
    `${PODNAPISI_BASE}/subtitles/search/advanced?keywords=${imdb}`;
  results.push(
    ...parseSearchResults(await fetchText(advUrl))
  );

  // 2️⃣ fallback
  if (results.length === 0) {
    const plainUrl =
      `${PODNAPISI_BASE}/subtitles/search/?keywords=${imdb}`;
    results.push(
      ...parseSearchResults(await fetchText(plainUrl))
    );
  }

  results = results.slice(0, 30);
  cacheSet(cache.search, imdb, results);
  return results;
}

/* ================= DOWNLOAD ================= */
async function downloadSrt(url) {
  const zip = await fetchBuffer(url);
  const dir = await unzipper.Open.buffer(zip);
  const srt = dir.files.find((f) =>
    f.path.toLowerCase().endsWith(".srt")
  );
  if (!srt) throw new Error("No SRT");
  return (await srt.buffer()).toString("utf8");
}

/* ================= ROUTES ================= */
app.get("/manifest.json", (_, res) =>
  res.json({
    id: "community.podnapisi.net.subtitles",
    version: "1.0.0",
    name: "Podnapisi.NET (no browser)",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  })
);

app.get("/subtitles/:type/:id.json", async (req, res) => {
  try {
    const imdb = parseImdb(req.params.id);
    if (!imdb) return res.json({ subtitles: [] });

    const list = await podnapisiSearch(imdb);

    res.json({
      subtitles: list.map((s, i) => {
        const fid = Buffer.from(
          s.downloadUrl
        ).toString("base64url");
        return {
          id: `podnapisi:${i}`,
          lang: s.lang,
          title: s.title,
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
    const url = Buffer.from(
      req.params.id,
      "base64url"
    ).toString();

    const cached = cacheGet(cache.files, url);
    if (cached)
      return res.type("text/vtt").send(cached);

    const srt = await downloadSrt(url);
    const vtt = srtToVtt(srt);

    cacheSet(cache.files, url, vtt);
    res.type("text/vtt").send(vtt);
  } catch (e) {
    res.status(500).send(String(e));
  }
});

/* ================= START ================= */
app.listen(PORT, () =>
  console.log(`🔥 Podnapisi addon running on ${PORT}`)
);
