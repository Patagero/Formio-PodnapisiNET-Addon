import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import url from "url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, "data");

const app = express();
app.use(cors());

/* ===== MANIFEST ===== */
const manifest = {
  id: "org.podnapisi.local-cache",
  version: "3.0.0",
  name: "Podnapisi.NET (local cache)",
  description: "Slovenski podnapisi – lokalni cache (sync)",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

/* ===== SUBTITLES ===== */
app.get("/subtitles/:type/:imdb/:extra?.json", (req, res) => {
  const { imdb } = req.params;

  const subs = [];

  const imdbDir = path.join(DATA_DIR, imdb);
  if (!fs.existsSync(imdbDir)) {
    return res.json({ subtitles: [] });
  }

  const files = fs.readdirSync(imdbDir).filter(f => f.endsWith(".srt"));

  for (const file of files) {
    const lang = path.basename(file, ".srt");

    subs.push({
      id: `${imdb}-${lang}`,
      lang,
      url: `${req.protocol}://${req.get("host")}/cache/${imdb}/${file}`,
      format: "srt"
    });
  }

  res.json({ subtitles: subs });
});

/* ===== SERVE LOCAL SRT ===== */
app.get("/cache/:imdb/:file", (req, res) => {
  const { imdb, file } = req.params;
  const filePath = path.join(DATA_DIR, imdb, file);

  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", "application/x-subrip");
  fs.createReadStream(filePath).pipe(res);
});

/* ===== ROOT ===== */
app.get("/", (req, res) => {
  res.send("Podnapisi.NET local cache addon running");
});

app.listen(PORT, () => {
  console.log(`Addon running on port ${PORT}`);
});
// ===============================
// FREE DAILY SYNC (node-cron)
// ===============================
if (process.env.ENABLE_SYNC_CRON === "1") {
  console.log("✅ Daily subtitle sync cron ENABLED");

  cron.schedule("0 3 * * *", () => {
    console.log("⏰ Running daily subtitle sync...");
    exec("npm run sync", (err, stdout, stderr) => {
      if (err) {
        console.error("❌ Sync error:", err);
      }
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    });
  });
}
