import fs from "fs/promises";
import path from "path";
import unzipper from "unzipper";
import { chromium } from "playwright";

const CONFIG_PATH = "./sync-config.json";

/* ================= HELPERS ================= */

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function extractFirstSrt(zipPath) {
  const zip = await unzipper.Open.file(zipPath);
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

/* ================= SEARCH (FINAL & ROBUST) ================= */

async function findSubtitlePage(page, item) {
  const query = buildQuery(item);
  const searchUrl =
    "https://www.podnapisi.net/sl/search?s=" +
    encodeURIComponent(query);

  console.log("🔍 Searching:", query);

  await page.goto(searchUrl, { waitUntil: "networkidle" });

  const subtitleUrl = await page.evaluate(() => {
    const links = Array.from(
      document.querySelectorAll("a[href^='/sl/subtitles/']")
    )
      .map(a => a.getAttribute("href"))
      .filter(href =>
        /^\/sl\/subtitles\/.+\/[A-Z0-9]{4}$/.test(href)
      );

    return links.length
      ? "https://www.podnapisi.net" + links[0]
      : null;
  });

  if (!subtitleUrl) {
    throw new Error("No valid subtitle result found");
  }

  return subtitleUrl;
}

/* ================= MAIN ================= */

async function run() {
  const cfg = await readJson(CONFIG_PATH);
  const outDir = cfg.outDir || "data";
  const tmpDir = "./tmp";

  await ensureDir(tmpDir);

  console.log("🚀 Starting Playwright (Render safe)");

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage"
    ]
  });

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  for (const it of cfg.items) {
    console.log(`SYNC ${it.type} | ${it.title}`);

    const subtitlePage = await findSubtitlePage(page, it);
    console.log("Found:", subtitlePage);

    await page.goto(subtitlePage, { waitUntil: "networkidle" });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("a, button"))
          .find(e =>
            (e.textContent || "").toLowerCase().includes("prenes")
          );
        if (!el) throw new Error("Download button not found");
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

    console.log("✅ Saved:", srtPath);
  }

  await browser.close();
  console.log("🏁 SYNC DONE");
}

run().catch(err => {
  console.error("❌ SYNC FAILED:", err);
  process.exit(1);
});
