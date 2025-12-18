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

/* ================= MAIN ================= */

async function run() {
  const cfg = await readJson(CONFIG_PATH);
  const outDir = cfg.outDir || "data";
  const tmpDir = "./tmp";

  await ensureDir(tmpDir);

  console.log("🚀 Starting REAL browser (non-headless)");

  const browser = await chromium.launch({
    headless: false, // ⬅️ KLJUČNO
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    acceptDownloads: true
  });

  const page = await context.newPage();

  for (const it of cfg.items) {
    const query = buildQuery(it);
    console.log(`SYNC ${it.type} | ${query}`);

    await page.goto(
      "https://www.podnapisi.net/sl/search?s=" + encodeURIComponent(query),
      { waitUntil: "networkidle" }
    );

    // počakaj, da se izriše tabela
    await page.waitForSelector("table", { timeout: 15000 });

    // klikni PRVI pravi rezultat (človeško)
    await page.click(
      "table tbody tr td a[href^='/sl/subtitles/']:not([href*='search'])"
    );

    console.log("Opened subtitle detail page");

    // klikni Prenesi
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("text=/Prenesi/i")
    ]);

    const zipPath = path.join(tmpDir, await download.suggestedFilename());
    await download.saveAs(zipPath);

    const srtBuffer = await extractFirstSrt(zipPath);

    const destDir = path.join(outDir, it.imdb);
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
