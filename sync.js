import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import unzipper from "unzipper";
import { chromium } from "playwright";

const CONFIG_PATH = "./sync-config.json";

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function extractFirstSrt(zipPath) {
  const directory = await unzipper.Open.file(zipPath);
  const srt = directory.files.find(f => f.path.toLowerCase().endsWith(".srt"));
  if (!srt) throw new Error("No .srt in ZIP");
  return await srt.buffer();
}

function buildQuery(item) {
  if (item.type === "movie") {
    return item.year ? `${item.title} ${item.year}` : item.title;
  }
  // series
  if (item.season && item.episode) {
    return `${item.title} S${String(item.season).padStart(2, "0")}E${String(item.episode).padStart(2, "0")}`;
  }
  return item.title;
}

async function findSubtitlePage(page, item) {
  const query = buildQuery(item);
  const url = `https://www.podnapisi.net/sl/search?s=${encodeURIComponent(query)}`;
  console.log("🔍 Searching:", query);

  await page.goto(url, { waitUntil: "networkidle" });

  // Najdi prvi slovenski zadetek
  const subtitleUrl = await page.evaluate((lang) => {
    const links = Array.from(document.querySelectorAll("a"))
      .filter(a =>
        a.href.includes("/subtitles/") &&
        (a.textContent.toLowerCase().includes("slov") ||
         a.textContent.toLowerCase().includes(lang))
      );
    return links.length ? links[0].href : null;
  }, item.lang);

  if (!subtitleUrl) throw new Error("No subtitles found");
  return subtitleUrl;
}

async function run() {
  const cfg = await readJson(CONFIG_PATH);
  const outDir = cfg.outDir || "data";
  const tmpDir = "./tmp";

  await ensureDir(tmpDir);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  for (const it of cfg.items) {
    console.log(`SYNC ${it.type} | ${it.title}`);

    const subtitlePage = await findSubtitlePage(page, it);
    console.log("Found:", subtitlePage);

    await page.goto(subtitlePage, { waitUntil: "networkidle" });

    // Sproži download (klik kjerkoli piše Prenesi)
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("a, button"))
          .find(e => (e.textContent || "").toLowerCase().includes("prenes"));
        if (!el) throw new Error("Download trigger not found");
        el.click();
      })
    ]);

    const zipPath = path.join(tmpDir, await download.suggestedFilename());
    await download.saveAs(zipPath);

    const srtBuffer = await extractFirstSrt(zipPath);

    let destDir;
    if (it.type === "series") {
      destDir = path.join(
        outDir,
        it.imdb,
        `s${String(it.season).padStart(2, "0")}`,
        `e${String(it.episode).padStart(2, "0")}`
      );
    } else {
      destDir = path.join(outDir, it.imdb);
    }

    await ensureDir(destDir);
    const srtPath = path.join(destDir, `${it.lang}.srt`);
    await fs.writeFile(srtPath, srtBuffer);

    console.log("Saved:", srtPath);
  }

  await browser.close();
}

run().catch(err => {
  console.error("SYNC FAILED:", err);
  process.exit(1);
});
