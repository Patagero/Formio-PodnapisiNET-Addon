import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import url from "url";
import cron from "node-cron";
import { exec } from "child_process";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, "data");

const app = express();
app.use(cors());

/* ================= MANIFEST ================= */

const manifest = {
  id: "org.podnapisi.local-cache",
  version: "3.2.3",
  name: "Podnapisi.NET (local cache)",
  description: "Slovenski podnapisi – local cache + auto search",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

/* ================= SUBTITLES ================= */

app.get("/subtitles/:type/:imdb/:extra?.json", async (req, res) => {
  const { type, imdb } = req.params;
  const { season, episode } = req.query;

  let baseDir = path.join(DATA_DIR, imdb);

  if (type === "series" && season && episode) {
    baseDir = path.join(
      DATA_DIR,
      imdb,
      `s${String(season).padStart(2, "0")}`,
      `e${String(episode).padStart(2, "0")}`
    );
  }

  if (!fs.existsSync(baseDir)) {
    return res.json({ subtitles: [] });
  }

  const subtitles = fs
    .readdirSync(baseDir)
    .filter(f => f.endsWith(".srt"))
    .map(f => {
      const lang = path.basename(f, ".srt");
      return {
        id: `${imdb}-${lang}`,
        lang,
        format: "srt",
        url: `${req.protocol}://${req.get("host")}/cache/${type}/${imdb}/${season || ""}/${episode || ""}/${f}`
      };
    });

  res.json({ subtitles });
});

/* ================= SERVE LOCAL FILE ================= */

app.get("/cache/:type/:imdb/:season?/:episode?/:file", (req, res) => {
  const { type, imdb, season, episode, file } = req.params;

  let filePath = path.join(DATA_DIR, imdb, file);

  if (type === "series" && season && episode) {
    filePath = path.join(
      DATA_DIR,
      imdb,
      `s${String(season).padStart(2, "0")}`,
      `e${String(episode).padStart(2, "0")}`,
      file
    );
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).end();
  }

  res.setHeader("Content-Type", "application/x-subrip");
  fs.createReadStream(filePath).pipe(res);
});

/* ================= MANUAL SYNC ================= */

app.get("/sync-now", (req, res) => {
  console.log("🟢 Manual sync triggered");

  exec("npm run sync", (err, stdout, stderr) => {
    if (err) console.error("❌ Sync error:", err);
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  });

  res.send("Sync started");
});

/* ================= ROOT ================= */

app.get("/", (req, res) => {
  res.send("Podnapisi.NET local cache addon running");
});

/* ================= START ================= */

app.listen(PORT, () => {
  console.log(`✅ Addon running on port ${PORT}`);
});

/* ================= CRON ================= */

if (process.env.ENABLE_SYNC_CRON === "1") {
  console.log("⏰ Daily sync ENABLED");

  cron.schedule("0 3 * * *", () => {
    exec("npm run sync");
  });
}