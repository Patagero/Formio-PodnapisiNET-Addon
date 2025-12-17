import express from "express";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

/* =====================
   GLOBAL REQUEST LOG
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
    id: "org.test.force-subtitles",
    version: "1.3.0", // ⚠️ VERSION BUMP (OBVEZNO)
    name: "Test Force Subtitles",
    description: "Working Stremio subtitle addon (wildcard fix)",
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
   (ključno!)
===================== */
app.get("/subtitles/:type/:id/*", (req, res) => {
  const { type, id } = req.params;

  console.log("SUBTITLES WILDCARD HIT:", {
    type,
    id,
    extraPath: req.params[0],
    query: req.query
  });

  res.json({
    subtitles: [
      {
        id: "test-eng",
        lang: "eng",
        url: "https://raw.githubusercontent.com/andreyvit/subtitle-tools/master/sample.srt"
      }
    ]
  });
});

/* =====================
   FALLBACK (DEBUG)
===================== */
app.use((req, res) => {
  console.log("UNHANDLED:", req.method, req.url);
  res.status(404).send("Not found");
});

/* =====================
   START
===================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`);
});
