import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const TMDB_KEY = process.env.TMDB_API_KEY;

/* ================= MANIFEST ================= */

const manifest = {
  id: "org.podnapisi.tmdb",
  version: "4.2.2",
  name: "Podnapisi.NET (TMDB resolve)",
  description: "IMDB → TMDB → Title → Podnapisi.NET",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

app.get("/manifest.json", (_, res) => res.json(manifest));

/* ================= HELPERS ================= */

async function imdbToTitle(imdb, type) {
  const url = `https://api.themoviedb.org/3/find/${imdb}?api_key=${TMDB_KEY}&external_source=imdb_id`;
  const data = await fetch(url).then(r => r.json());

  if (type === "movie" && data.movie_results?.length) {
    return data.movie_results[0].title;
  }

  if (type === "series" && data.tv_results?.length) {
    return data.tv_results[0].name;
  }

  return null;
}

function cleanTitle(t) {
  return t.replace(/[\.\-_]/g, " ").replace(/\s+/g, " ").trim();
}

/* ================= SUBTITLES ================= */

app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const { type, id } = req.params;

  let title = null;

  try {
    if (id.startsWith("tt")) {
      title = await imdbToTitle(id, type);
    }

    if (!title) {
      console.log("❌ TMDB resolve failed for", id);
      return res.json({ subtitles: [] });
    }

    title = cleanTitle(title);
    console.log("🔍 Searching Podnapisi.NET for:", title);

    const searchUrl = `https://www.podnapisi.net/subtitles/search/${encodeURIComponent(title)}`;
    const html = await fetch(searchUrl).then(r => r.text());

    const matches = [...html.matchAll(/\/subtitles\/(\d+)/g)];

    const subtitles = matches.slice(0, 5).map(m => ({
      id: m[1],
      lang: "sl",
      format: "srt",
      url: `https://www.podnapisi.net/subtitles/${m[1]}/download`
    }));

    res.json({ subtitles });
  } catch (e) {
    console.error(e);
    res.json({ subtitles: [] });
  }
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log("✅ Podnapisi.NET TMDB addon running on", PORT);
});