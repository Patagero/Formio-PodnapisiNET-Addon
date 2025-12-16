import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import unzipper from "unzipper";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

/* ===========================
   MANIFEST
=========================== */
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.formio.podnapisi",
    version: "1.0.0",
    name: "Podnapisi.NET 🇸🇮",
    description: "Slovenski podnapisi iz Podnapisi.NET",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

/* ===========================
   IMDb → TITLE
=========================== */
async function imdbToTitle(imdb) {
  const html = await fetch(`https://www.imdb.com/title/${imdb}/`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"
    }
  }).then(r => r.text());

  const $ = cheerio.load(html);
  const title = $("meta[property='og:title']")
    .attr("content")
    ?.replace(/\(\d{4}\).*/, "")
    .trim();

  console.log("🎬 IMDb:", imdb, "→", title);
  return title;
}

/* ===========================
   SEARCH PODNAPISI.NET
=========================== */
async function searchPodnapisi(title) {
  const url =
    "https://www.podnapisi.net/sl/subtitles/search?keywords=" +
    encodeURIComponent(title) +
    "&language=sl";

  console.log("🔍 SEARCH:", title);

  const html = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"
    }
  }).then(r => r.text());

  const $ = cheerio.load(html);
  const results = [];

  $("a[href*='/download']").each((_, el) => {
    const href = $(el).attr("href");
    const name = $(el).text().trim();

    if (!href || !name) return;

    results.push({
      id: href,
      lang: "sl",
      title: name,
      download: "https://www.podnapisi.net" + href
    });
  });

  console.log("➡️ FOUND:", results.length);
  return results;
}

/* ===========================
   DOWNLOAD + UNZIP
=========================== */
async function downloadSubtitle(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120"
    }
  });

  const buffer = Buffer.from(await res.arrayBuffer());
  const zip = await unzipper.Open.buffer(buffer);

  for (const file of zip.files) {
    if (file.path.endsWith(".srt")) {
      return (await file.buffer()).toString("utf-8");
    }
  }

  return null;
}

/* ===========================
   SUBTITLES ENDPOINT
=========================== */
app.get("/subtitles/:type/:imdb.json", async (req, res) => {
  try {
    const title = await imdbToTitle(req.params.imdb);
    if (!title) return res.json({ subtitles: [] });

    const found = await searchPodnapisi(title);
    const out = [];

    for (const s of found.slice(0, 5)) {
      const text = await downloadSubtitle(s.download);
      if (!text) continue;

      out.push({
        id: s.id,
        lang: "sl",
        title: s.title,
        content: text
      });
    }

    res.json({ subtitles: out });
  } catch (e) {
    console.error("❌ ERROR:", e);
    res.json({ subtitles: [] });
  }
});

/* ===========================
   START
=========================== */
app.listen(PORT, () =>
  console.log("🔥 ADDON RUNNING ON", PORT)
);
