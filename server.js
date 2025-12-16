import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 10000;

/* -------------------- HELPERS -------------------- */

function extractMovieTitle(filename = "") {
  if (!filename) return "";

  let name = filename;

  // odstrani končnico
  name = name.replace(/\.[^/.]+$/, "");

  // pike -> presledki
  name = name.replace(/\./g, " ");

  // odreži vse po letnici
  name = name.replace(/\b(19|20)\d{2}\b.*$/, "");

  return name.trim();
}

/* -------------------- MANIFEST -------------------- */

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

/* -------------------- SUBTITLES -------------------- */

app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  try {
    const filename = req.query.filename || "";

    console.log("🎬 FILENAME:", filename);

    const title = extractMovieTitle(filename);
    console.log("🔍 SEARCHING:", title);

    if (!title) {
      return res.json({ subtitles: [] });
    }

    const searchUrl =
      "https://www.podnapisi.net/sl/subtitles/search/?keywords=" +
      encodeURIComponent(title) +
      "&language=sl";

    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html"
      }
    });

    if (!response.ok) {
      console.log("❌ Search failed:", response.status);
      return res.json({ subtitles: [] });
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const subs = [];

    $(".subtitle-entry").each((_, el) => {
      const link = $(el).find("a").attr("href");
      const name = $(el).find(".title").text().trim();

      if (!link) return;

      subs.push({
        id: link,
        lang: "sl",
        name,
        url: "https://www.podnapisi.net" + link
      });
    });

    console.log("➡️ NAJDENIH:", subs.length);

    res.json({ subtitles: subs });
  } catch (err) {
    console.error("💥 ERROR:", err);
    res.json({ subtitles: [] });
  }
});

/* -------------------- START -------------------- */

app.listen(PORT, () => {
  console.log("🔥 RUNNING ON", PORT);
});
