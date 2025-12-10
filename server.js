import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "8.0.0",
  name: "Formio Podnapisi.NET 🇸🇮 (LITE + SRT DOWNLOAD)",
  description: "Slovenski podnapisi za Stremio – direktni ZIP → SRT extractor, brez Puppeteer.",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// IMDb → Title
async function getTitleFromIMDb(imdbId) {
  try {
    const r = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const d = await r.json();
    if (d?.Title) {
      console.log(`🎬 IMDb: ${imdbId} → ${d.Title}`);
      return d.Title;
    }
  } catch {}
  return imdbId;
}

// MAIN SCRAPER (new + old Podnapisi.net layout)
async function searchSlovenianSubs(imdbId) {
  const title = await getTitleFromIMDb(imdbId);

  const searchUrl =
    "https://www.podnapisi.net/sl/subtitles/search/?" +
    `keywords=${encodeURIComponent(title)}&language=sl`;

  console.log("🌍 SCRAPING:", searchUrl);

  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "sl,en;q=0.8"
    }
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  // 1️⃣ NEW Podnapisi layout – results stored in ".media"
  $(".media").each((i, el) => {
    const a = $(el).find("a[href*='/sl/subtitles/']").first();

    const href = a.attr("href");
    let name = a.text().trim();

    if (!href) return;
    const full = href.startsWith("http")
      ? href
      : `https://www.podnapisi.net${href}`;

    if (seen.has(full)) return;
    seen.add(full);
    if (!name) name = "Podnapisi";

    results.push({
      id: `slo-${results.length + 1}`,
      lang: "sl",
      // LINK → goes through our /download endpoint
      url: `/download?url=${encodeURIComponent(full)}`,
      title: `${name} 🇸🇮`
    });
  });

  // 2️⃣ OLD LAYOUT (fallback)
  if (results.length === 0) {
    $("table.table tbody tr").each((i, row) => {
      const a = $(row)
        .find("a[href*='/download'], a[href*='/subtitles/']")
        .first();

      const href = a.attr("href");
      let name = a.text().trim();
      if (!href) return;

      const full = href.startsWith("http")
        ? href
        : `https://www.podnapisi.net${href}`;

      if (seen.has(full)) return;
      seen.add(full);
      if (!name) name = "Podnapisi";

      results.push({
        id: `slo-${results.length + 1}`,
        lang: "sl",
        url: `/download?url=${encodeURIComponent(full)}`,
        title: `${name} 🇸🇮`
      });
    });
  }

  // 3️⃣ Regex fallback
  if (results.length === 0) {
    const regex = /href="([^"]*\/sl\/subtitles\/[^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const full = match[1].startsWith("http")
        ? match[1]
        : `https://www.podnapisi.net${match[1]}`;

      const name = match[2].trim() || "Podnapisi";

      if (seen.has(full)) continue;
      seen.add(full);

      results.push({
        id: `slo-${results.length + 1}`,
        lang: "sl",
        url: `/download?url=${encodeURIComponent(full)}`,
        title: `${name} 🇸🇮`
      });
    }
  }

  console.log(`➡️ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// ZIP → SRT extractor
app.get("/download", async (req, res) => {
  try {
    const fileUrl = req.query.url;
    if (!fileUrl) return res.status(400).send("Missing url");

    console.log("⬇️ Fetching ZIP:", fileUrl);

    const r = await fetch(fileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "sl,en;q=0.9"
      }
    });

    const buf = Buffer.from(await r.arrayBuffer());

    const zip = new AdmZip(buf);
    const entries = zip.getEntries();

    const srtEntry = entries.find(e => e.entryName.toLowerCase().endsWith(".srt"));

    if (!srtEntry) {
      console.log("❌ ZIP does not contain .srt");
      return res.status(404).send("No SRT found");
    }

    const srtText = srtEntry.getData().toString("utf8");

    res.setHeader("Content-Type", "application/x-subrip");
    res.send(srtText);

  } catch (err) {
    console.log("❌ DOWNLOAD ERROR:", err);
    res.status(500).send("Error extracting SRT");
  }
});

// ROUTES
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;

  console.log("==================================================");
  console.log("🎬 IMDb Request:", imdbId);

  try {
    const subs = await searchSlovenianSubs(imdbId);

    const base = "https://formio-podnapisinet-addon-1.onrender.com";

    // add full URLs for Stremio
    subs.forEach(s => {
      s.url = `${base}${s.url}`;
    });

    res.json({ subtitles: subs });
  } catch (err) {
    console.log("💥 ERROR:", err);
    res.json({ subtitles: [] });
  }
});

app.get("/", (req, res) => res.redirect("/manifest.json"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(" Formio Podnapisi.NET 🇸🇮 — FINAL VERSION ACTIVE");
  console.log(" ZIP → SRT Extractor READY");
  console.log("==================================================");
});
