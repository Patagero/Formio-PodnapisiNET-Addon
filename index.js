import express from "express";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 10000;

/* MANIFEST */
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.podnapisi.filename",
    version: "4.0.1",
    name: "Podnapisi.NET (a4k-style)",
    description: "Slovenski podnapisi iz Podnapisi.NET (HTML scrape)",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

/* HEADERS */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "sl-SI,sl,en-US,en;q=0.5",
  "Referer": "https://www.podnapisi.net/",
  "Cookie": "lang=sl"
};

/* SUBTITLES */
app.get("/subtitles/:type/:id.json", async (req, res) => {
  const raw = req.params.id;
  const query = raw.startsWith("tt") ? raw : decodeURIComponent(raw);

  console.log("🔍 Searching Podnapisi.NET for:", query);

  try {
    const searchUrl =
      "https://www.podnapisi.net/subtitles/search/?" +
      "keywords=" + encodeURIComponent(query) +
      "&language=sl";

    const response = await fetch(searchUrl, { headers: HEADERS });

    if (!response.ok) {
      console.error("❌ HTTP", response.status);
      return res.json({ subtitles: [] });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const subtitles = [];

    $(".subtitle-entry").each((_, el) => {
      const title = $(el).find(".title a").text().trim();
      const page = $(el).find(".title a").attr("href");

      const idMatch = page?.match(/subtitles\/(\d+)/);
      if (!idMatch) return;

      subtitles.push({
        id: "podnapisi-" + idMatch[1],
        lang: "sl",
        name: title,
        format: "srt",
        url: `https://www.podnapisi.net/subtitles/${idMatch[1]}/download`
      });
    });

    res.json({ subtitles });
  } catch (err) {
    console.error("❌ ERROR:", err.message);
    res.json({ subtitles: [] });
  }
});

/* ROOT */
app.get("/", (_, res) => res.send("Podnapisi.NET addon running"));

app.listen(PORT, () =>
  console.log(`✅ Podnapisi.NET addon running on ${PORT}`)
);