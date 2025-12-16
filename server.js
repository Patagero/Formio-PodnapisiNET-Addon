import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import unzipper from "unzipper";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

/* ========== MANIFEST ========== */
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

/* ========== SUBTITLES ========== */
app.get("/subtitles/:type/:imdbId.json", async (req, res) => {
  try {
    const imdbId = req.params.imdbId;

    const imdbHtml = await fetch(`https://www.imdb.com/title/${imdbId}/`).then(r => r.text());
    const title = imdbHtml.match(/<title>(.*?)<\/title>/)?.[1]?.split("(")[0]?.trim();

    if (!title) return res.json({ subtitles: [] });

    const searchUrl =
      `https://www.podnapisi.net/sl/subtitles/search?keywords=${encodeURIComponent(title)}&language=sl`;

    const html = await fetch(searchUrl).then(r => r.text());
    const $ = cheerio.load(html);

    const subs = [];

    $(".subtitle-entry a").each((i, el) => {
      if (i >= 5) return;

      const href = $(el).attr("href");
      if (!href) return;

      const id = href.split("/").pop();

      subs.push({
        id: `pn-${id}`,
        lang: "sl",
        url: `${req.protocol}://${req.get("host")}/download/${id}.srt`
      });
    });

    res.json({ subtitles: subs });
  } catch (err) {
    console.error("SUB ERROR:", err);
    res.json({ subtitles: [] });
  }
});

/* ========== DOWNLOAD ========== */
app.get("/download/:id.srt", async (req, res) => {
  try {
    const id = req.params.id;
    const zipUrl = `https://www.podnapisi.net/subtitles/${id}/download`;

    const zip = await fetch(zipUrl);
    const buffer = await zip.arrayBuffer();

    const directory = await unzipper.Open.buffer(Buffer.from(buffer));
    const file = directory.files.find(f => f.path.endsWith(".srt"));

    if (!file) return res.status(404).send("No SRT");

    const content = await file.buffer();
    res.setHeader("Content-Type", "application/x-subrip");
    res.send(content);
  } catch (err) {
    console.error("DL ERROR:", err);
    res.status(500).send("Download failed");
  }
});

/* ========== RUN ========== */
app.listen(PORT, () => {
  console.log("🔥 ADDON RUNNING ON", PORT);
});
