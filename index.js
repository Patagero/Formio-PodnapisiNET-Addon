import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 10000;

/* ================= MANIFEST ================= */

const manifest = {
  id: "org.podnapisi.filename",
  version: "4.0.0",
  name: "Podnapisi.NET (a4k-style)",
  description: "Slovenski podnapisi iz Podnapisi.NET (a4k HTML logic)",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

/* ================= HEADERS (CRITICAL) ================= */

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/120.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "sl-SI,sl,en-US,en;q=0.5",
  "Referer": "https://www.podnapisi.net/"
};

/* ================= SUBTITLES ================= */

app.get("/subtitles/:type/:id.json", async (req, res) => {
  const raw = req.params.id;
  const query = raw.startsWith("tt") ? raw : decodeURIComponent(raw);

  console.log("🔍 Searching Podnapisi.NET for:", query);

  try {
    const searchUrl =
      "https://www.podnapisi.net/subtitles/search/?" +
      "keywords=" + encodeURIComponent(query) +
      "&language=sl";

    const html = await fetch(searchUrl, { headers: HEADERS }).then(r => r.text());
    const $ = cheerio.load(html);

    const results = [];

    $(".subtitle-entry").each((_, el) => {
      const title = $(el).find(".title a").text().trim();
      const page = $(el).find(".title a").attr("href");

      if (!page) return;

      const idMatch = page.match(/subtitles\/(\d+)/);
      if (!idMatch) return;

      const subId = idMatch[1];

      results.push({
        id: "podnapisi-" + subId,
        lang: "sl",
        name: title,
        format: "srt",
        url: `https://www.podnapisi.net/subtitles/${subId}/download`
      });
    });

    res.json({ subtitles: results });
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.json({ subtitles: [] });
  }
});

/* ================= ROOT ================= */

app.get("/", (req, res) => {
  res.send("Podnapisi.NET a4k-style addon running");
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`✅ Podnapisi.NET addon running on ${PORT}`);
});