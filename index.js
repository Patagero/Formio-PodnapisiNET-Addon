import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

/* ================= MANIFEST ================= */

const manifest = {
  id: "org.podnapisi.filename",
  version: "4.0.0",
  name: "Podnapisi.NET (filename fallback)",
  description: "Slovenski podnapisi – IMDB → filename → title",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

app.get("/manifest.json", (_, res) => {
  res.json(manifest);
});

/* ================= HELPERS ================= */

function cleanTitle(str = "") {
  return str
    .replace(/\.[^.]+$/, "")              // remove extension
    .replace(/[\.\-_]/g, " ")
    .replace(/\b(2160p|1080p|720p|WEB|WEB-DL|BluRay|NF|AMZN|x264|x265|HDR|DV)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ================= SUBTITLES ================= */

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { id } = req.params;
  const { filename, title } = req.query;

  let searchQuery = null;

  if (id.startsWith("tt")) {
    searchQuery = id;
  } else if (filename) {
    searchQuery = cleanTitle(filename);
  } else if (title) {
    searchQuery = cleanTitle(title);
  }

  if (!searchQuery) {
    return res.json({ subtitles: [] });
  }

  console.log("🔍 Searching subtitles for:", searchQuery);

  try {
    const url = `https://www.podnapisi.net/subtitles/search/${encodeURIComponent(searchQuery)}`;
    const html = await fetch(url).then(r => r.text());

    const matches = [...html.matchAll(/\/subtitles\/(\d+)/g)];

    const subtitles = matches.slice(0, 5).map(m => ({
      id: m[1],
      lang: "sl",
      url: `https://www.podnapisi.net/subtitles/${m[1]}/download`,
      format: "srt"
    }));

    res.json({ subtitles });
  } catch (e) {
    console.error(e);
    res.json({ subtitles: [] });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("✅ Podnapisi.NET filename addon running on", PORT);
});