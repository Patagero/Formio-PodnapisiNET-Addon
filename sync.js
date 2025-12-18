import fs from "fs/promises";
import path from "path";
import unzipper from "unzipper";
import fetch from "node-fetch";
import cheerio from "cheerio";

const CONFIG_PATH = "./sync-config.json";
const BASE = "https://www.podnapisi.net";

/* ================= HELPERS ================= */

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function extractFirstSrt(zipBuffer) {
  const zip = await unzipper.Open.buffer(zipBuffer);
  const srt = zip.files.find(f => f.path.toLowerCase().endsWith(".srt"));
  if (!srt) throw new Error("No .srt found in ZIP");
  return await srt.buffer();
}

function buildQuery(item) {
  if (item.type === "movie") {
    return item.year ? `${item.title} ${item.year}` : item.title;
  }
  if (item.type === "series") {
    return `${item.title} S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  }
  return item.title;
}

/* ================= SEARCH ================= */

async function findSubtitleUrl(query) {
  const res = await fetch(
    `${BASE}/sl/search?s=${encodeURIComponent(query)}`,
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );

  const html = await res.text();
  const $ = cheerio.load(html);

  const link = $("a[href^='/sl/subtitles/']")
    .map((_, a) => $(a).attr("href"))
    .get()
    .find(h =>
      h &&
      !h.includes("/search/") &&
      h.split("/").pop().length === 4
    );

  if (!link) throw new Error("No subtitle found");

  return BASE + link;
}

async function downloadZip(subtitlePageUrl) {
  const page = await fetch(subtitlePageUrl, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  const html = await page.text();
  const $ = cheerio.load(html);

  const zipPath = $("a[href$='.zip']").attr("href");
  if (!zipPath) throw new Error("ZIP link not found");

  const zipRes = await fetch(BASE + zipPath, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });

  return Buffer.from(await zipRes.arrayBuffer());
}

/* ================= MAIN ================= */

async function run() {
  const cfg = await readJson(CONFIG_PATH);
  const outDir = cfg.outDir || "data";

  for (const it of cfg.items) {
    const query = buildQuery(it);
    console.log("🔍 Searching:", query);

    const subtitlePage = await findSubtitleUrl(query);
    console.log("Found:", subtitlePage);

    const zipBuffer = await downloadZip(subtitlePage);
    const srtBuffer = await extractFirstSrt(zipBuffer);

    const destDir = path.join(outDir, it.imdb);
    await ensureDir(destDir);

    const srtPath = path.join(destDir, `${it.lang}.srt`);
    await fs.writeFile(srtPath, srtBuffer);

    console.log("✅ Saved:", srtPath);
  }

  console.log("🏁 SYNC DONE");
}

run().catch(err => {
  console.error("❌ SYNC FAILED:", err);
  process.exit(1);
});
