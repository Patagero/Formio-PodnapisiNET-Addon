import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import unzipper from "unzipper";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

/* =====================
   MANIFEST
===================== */
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.podnapisi.sl",
    version: "1.5.0",
    name: "Podnapisi.NET (SL)",
    description: "Slovenski podnapisi iz Podnapisi.NET (proxy)",
    resources: [
      { name: "stream", types: ["movie"], idPrefixes: ["tt"] },
      { name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }
    ],
    types: ["movie"],
    idPrefixes: ["tt"]
  });
});

/* =====================
   DUMMY STREAM
===================== */
app.get("/stream/:type/:id", (req, res) => {
  res.json({ streams: [] });
});

/* =====================
   SUBTITLES
===================== */
app.get("/subtitles/:type/:id/*", async (req, res) => {
  const { id } = req.params;

  if (id !== "tt0120338") {
    return res.json({ subtitles: [] });
  }

  res.json({
    subtitles: [
      {
        id: "titanic-dgji",
        lang: "slv",
        url: `https://${req.headers.host}/subtitle/DGJI.srt`
      }
    ]
  });
});

/* =====================
   PROXY: ZIP → SRT
===================== */
app.get("/subtitle/DGJI.srt", async (req, res) => {
  try {
    const zipUrl = "https://www.podnapisi.net/subtitles/download/DGJI";

    const response = await fetch(zipUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.podnapisi.net/"
      }
    });

    if (!response.ok) {
      return res.status(500).send("Failed to fetch ZIP");
    }

    const zipStream = response.body.pipe(unzipper.Parse());

    for await (const entry of zipStream) {
      if (entry.path.endsWith(".srt")) {
        res.setHeader("Content-Type", "application/x-subrip");
        entry.pipe(res);
        return;
      } else {
        entry.autodrain();
      }
    }

    res.status(404).send("SRT not found in ZIP");
  } catch (err) {
    console.error(err);
    res.status(500).send("Subtitle proxy error");
  }
});

/* =====================
   START
===================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`);
});
