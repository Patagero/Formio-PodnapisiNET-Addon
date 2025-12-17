import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

/* =====================
   GLOBAL LOG (debug)
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
    version: "1.4.0", // ⚠️ VERSION BUMP
    name: "Podnapisi.NET (SL)",
    description: "Slovenski podnapisi iz Podnapisi.NET",
    resources: [
      { name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] },
      { name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] }
    ],
    types: ["movie", "series"],
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
   SUBTITLES – WILDCARD
===================== */
app.get("/subtitles/:type/:id/*", (req, res) => {
  const { type, id } = req.params;

  console.log("SUBTITLES REQUEST:", {
    type,
    imdb: id,
    extraPath: req.params[0]
  });

  // HARD-CODED TEST: Titanic (1997) – Podnapisi.NET ID DGJI
  if (id === "tt0120338") {
    return res.json({
      subtitles: [
        {
          id: "podnapisi-dgji",
          lang: "slv", // Slovenščina (ISO-639-2)
          url: "https://www.podnapisi.net/subtitles/download/DGJI"
        }
      ]
    });
  }

  // Za vse ostale filme trenutno nič
  res.json({ subtitles: [] });
});

/* =====================
   START
===================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`);
});
