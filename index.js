import express from "express";
import cors from "cors";
import unzipper from "unzipper";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

/* =====================
   LOG (debug)
===================== */
app.use((req, res, next) => {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket.remoteAddress;

  console.log(
    "REQ",
    req.method,
    req.url,
    "| ip:",
    ip,
    "| ua:",
    req.headers["user-agent"] || "-"
  );
  next();
});

/* =====================
   MANIFEST
===================== */
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.podnapisi.sl",
    version: "2.0.0", // 🔥 FINAL VERSION
    name: "Podnapisi.NET (Slovenščina)",
    description: "Slovenski podnapisi iz Podnapisi.NET (proxy + unzip)",
    resources: [
      { name: "stream", types: ["movie"], idPrefixes: ["tt"] },
      { name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }
    ],
    types: ["movie"],
    idPrefixes: ["tt"]
  });
});

/* =====================
   DUMMY STREAMS
===================== */
app.get("/stream/:type/:id.json", (req, res) => {
  res.json({ streams: [] });
});
app.get("/stream/:type/:id", (req, res) => {
  res.json({ streams: [] });
});

/* =====================
   SUBTITLES (Stremio → addon)
===================== */
app.get("/subtitles/:type/:id/*", (req, res) => {
  const { id } = req.params;

  // TEST: Titanic (1997)
  if (id === "tt0120338") {
    return res.json({
      subtitles: [
        {
          id: "podnapisi-dgji",
          lang: "slv",
          url: `https://${req.headers.host}/subtitle/DGJI.srt`
        }
      ]
    });
  }

  res.json({ subtitles: [] });
});

/* =====================
   PROXY: Podnapisi.NET ZIP → SRT
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

    if (!response.ok || !response.body) {
      return res.status(500).send("Failed to fetch subtitle ZIP");
    }

    const zipStream = response.body.pipe(unzipper.Parse());

    for await (const entry of zipStream) {
      if (entry.path.toLowerCase().endsWith(".srt")) {
        res.setHeader("Content-Type", "application/x-subrip");
        entry.pipe(res);
        return;
      } else {
        entry.autodrain();
      }
    }

    res.status(404).send("SRT not found in ZIP");
  } catch (err) {
    console.error("SUBTITLE PROXY ERROR:", err);
    res.status(500).send("Subtitle proxy error");
  }
});

/* =====================
   START
===================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`);
});
