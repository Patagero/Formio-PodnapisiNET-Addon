import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";   // <-- FIXED
import AdmZip from "adm-zip";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

function clean(str) {
  return str.replace(/\s+/g, " ").trim();
}

async function searchSubs(title) {
  try {
    console.log("🔍 Searching:", title);

    const url =
      "https://www.podnapisi.net/sl/subtitles/search/?keywords=" +
      encodeURIComponent(title) +
      "&language=sl";

    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const html = await res.text();
    const $ = cheerio.load(html);

    const out = [];

    $(".subtitle-entry").each((i, el) => {
      const link = $(el).find("a").attr("href");
      const name = clean($(el).find("a").text());
      if (!link) return;

      out.push({
        id: link.split("/").pop(),
        name,
        page: "https://www.podnapisi.net" + link,
      });
    });

    console.log("➡️ Najdenih:", out.length);
    return out;

  } catch (err) {
    console.log("❌ Search error:", err);
    return [];
  }
}

async function downloadSrt(pageUrl) {
  try {
    console.log("⬇ Downloading from:", pageUrl);

    const zipUrl = pageUrl + "/download";

    const r = await fetch(zipUrl, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });

    const buf = Buffer.from(await r.arrayBuffer());
    const zip = new AdmZip(buf);

    const entries = zip.getEntries();

    for (const f of entries) {
      if (f.entryName.endsWith(".srt")) {
        console.log("📦 Extracted:", f.entryName);
        return zip.readAsText(f);
      }
    }

    console.log("❌ ZIP had no SRT");
    return null;

  } catch (err) {
    console.log("❌ Download error:", err);
    return null;
  }
}

app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.formio.podnapisi",
    version: "1.0.0",
    name: "Podnapisi.NET Stremio Addon",
    description: "Slovenski podnapisi iz Podnapisi.NET",
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    resources: ["subtitles"]
  });
});

app.get("/subtitles/:type/:imdb.json", async (req, res) => {
  const imdb = req.params.imdb;
  const filename = req.query.filename || "";
  console.log("🎬 FILENAME:", filename);

  const guessTitle = filename.replace(/\.\d+p.*$/i, "").replace(/\./g, " ");

  const searchTitle = guessTitle.trim() || imdb;

  const found = await searchSubs(searchTitle);

  const out = [];

  for (const s of found) {
    const text = await downloadSrt(s.page);
    if (!text) continue;

    out.push({
      id: s.id,
      lang: "sl",
      title: s.name,
      subtitles: text
    });
  }

  res.json({ subtitles: out });
});

app.listen(PORT, () => {
  console.log(`🔥 RUNNING ON ${PORT}`);
});
