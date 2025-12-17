import express from "express";
import cors from "cors";

const app = express();

// CORS (Stremio zahteva CORS za HTTP addone) :contentReference[oaicite:1]{index=1}
app.use(cors());

// LOGIRAJ VSE REQUESTE (ključno)
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

const PORT = process.env.PORT || 7000;

// MANIFEST (resources kot objekti + nov id + nov version)
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.test.force-subtitles.debug",
    version: "1.2.0",
    name: "Force Subtitles DEBUG",
    description: "Debug addon: logs requests, forces Stremio subtitle calls",
    resources: [
      { name: "subtitles", types: ["movie", "series"], idPrefixes: ["tt"] },
      { name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }
    ],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  });
});

// DUMMY STREAM endpoint (Stremio uporablja /stream/...) :contentReference[oaicite:2]{index=2}
app.get("/stream/:type/:id.json", (req, res) => {
  res.json({ streams: [] });
});
app.get("/stream/:type/:id", (req, res) => {
  res.json({ streams: [] });
});

// SUBTITLES endpoint (oba formata)
const subsResponse = {
  subtitles: [
    {
      id: "test-eng",
      lang: "eng",
      url: "https://raw.githubusercontent.com/andreyvit/subtitle-tools/master/sample.srt"
    }
  ]
};

app.get("/subtitles/:type/:id.json", (req, res) => res.json(subsResponse));
app.get("/subtitles/:type/:id", (req, res) => res.json(subsResponse));

// Ping
app.get("/ping", (req, res) => res.send("pong"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`);
});
