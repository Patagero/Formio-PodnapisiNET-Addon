import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import cors from "cors";
import unzipper from "unzipper";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const TMP_DIR = "/tmp/subs";
fs.mkdirSync(TMP_DIR, { recursive: true });

/* =========================
   MANIFEST
========================= */
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

/* =========================
   SUBTITLES (STREMIO FIX)
========================= */
app.get(/^\/subtitles\/(movie|series)\/([^\/]+).*\.json$/, async (req, res) => {
  const imdbId = req.params[1];

  console.log("🎬 IMDb:", imdbId);

  try {
    const title = await imdbToTitle(imdbId);
    console.log("🔍 SEARCH:", title);

    const subs = await searchPodnapisi(title);

    console.log("➡️ FOUND:", subs.length);
    res.json({ subtitles: subs });
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.json({ subtitles: [] });
  }
});

/* =========================
   IMDb → TITLE
========================= */
async function imdbToTitle(imdb) {
  const url = `https://v2.sg.media-imdb.com/suggestion/${imdb[2]}/${imdb}.json`;
  const j = await fetch(url).then(r => r.json());
  return j.d?.[0]?.l || imdb;
}

/* =========================
   PODNAPISI SEARCH
========================= */
async function searchPodnapisi(title) {
  const searchUrl =
    "https://www.podnapisi.net/sl/subtitles/search?keywords=" +
    encodeURIComponent(title) +
    "&language=sl";

  const html = await fetch(searchUrl, {
    headers: { "User-Agent": "Mozilla/5.0" }
  }).then(r => r.text());

  const $ = cheerio.load(html);
  const results = [];

  $(".subtitle-entry").each((_, el) => {
    const link = $(el).find("a.download").attr("href");
    const name = $(el).find(".subtitle-title").text().trim();

    if (!link) return;

    results.push({
      id: link,
      lang: "sl",
      name,
      url: `https://formio-podnapisinet-addon.onrender.com/download?url=https://www.podnapisi.net${link}`
    });
  });

  return results;
}

/* =========================
   DOWNLOAD + UNZIP
========================= */
app.get("/download", async (req, res) => {
  const zipUrl = req.query.url;
  if (!zipUrl) return res.sendStatus(400);

  const zipPath = path.join(TMP_DIR, Date.now() + ".zip");

  const zipRes = await fetch(zipUrl);
  await pipeline(zipRes.body, fs.createWriteStream(zipPath));

  const directory = await unzipper.Open.file(zipPath);
  const srt = directory.files.find(f => f.path.endsWith(".srt"));

  if (!srt) return res.sendStatus(404);

  res.setHeader("Content-Type", "application/x-subrip");
  await pipeline(srt.stream(), res);
});

/* =========================
   START
========================= */
app.listen(PORT, () =>
  console.log("🔥 ADDON RUNNING ON", PORT)
);
