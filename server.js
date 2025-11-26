import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "7.3.0",
  name: "Formio Podnapisi.NET 🇸🇮 (LITE)",
  description: "Stabilna verzija brez Puppeteer – poenostavljen HTML scraping",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

// IMDb → Title
async function getTitleFromIMDb(imdbId) {
  try {
    const r = await fetch(
      `https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`
    );
    const d = await r.json();
    if (d?.Title) {
      console.log(`🎬 IMDb: ${imdbId} → ${d.Title}`);
      return d.Title;
    }
  } catch (err) {
    console.log("IMDb error:", err.message);
  }
  return imdbId;
}

// Direktni fetch na Podnapisi.net, brez Puppeteerja, brez proxyja
async function searchSlovenianSubs(imdbId) {
  const title = await getTitleFromIMDb(imdbId);

  const searchUrl =
    "https://www.podnapisi.net/sl/subtitles/search/?" +
    `keywords=${encodeURIComponent(title)}&language=sl`;

  console.log("🌍 SCRAPING:", searchUrl);

  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Accept-Language": "sl,en;q=0.8"
    }
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  // 1) Poskusi novi layout – vsi linki na /sl/subtitles/
  $("a[href*='/sl/subtitles/']").each((i, el) => {
    const href = $(el).attr("href");
    let name = $(el).text().trim();

    if (!href) return;

    const full =
      href.startsWith("http") ? href : `https://www.podnapisi.net${href}`;

    if (seen.has(full)) return;
    seen.add(full);

    if (!name) name = "Podnapisi";

    results.push({
      id: `slo-${results.length + 1}`,
      lang: "sl",
      url: full,
      title: `${name} 🇸🇮`
    });
  });

  // 2) Fallback – stari layout (tabela)
  if (results.length === 0) {
    $("table.table tbody tr").each((i, row) => {
      const a = $(row)
        .find("a[href*='/download'], a[href*='/subtitles/']")
        .first();
      const href = a.attr("href");
      let name = a.text().trim();

      if (!href) return;

      const full =
        href.startsWith("http") ? href : `https://www.podnapisi.net${href}`;

      if (seen.has(full)) return;
      seen.add(full);

      if (!name) name = "Podnapisi";

      results.push({
        id: `slo-${results.length + 1}`,
        lang: "sl",
        url: full,
        title: `${name} 🇸🇮`
      });
    });
  }

  // 3) Fallback regex – karkoli, kar izgleda kot link na subtitles
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
        url: full,
        title: `${name} 🇸🇮`
      });
    }
  }

  console.log(`➡️ Najdenih ${results.length} slovenskih podnapisov`);
  return results;
}

// ROUTES
app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;

  console.log("==================================================");
  console.log("🎬 IMDb Request:", imdbId);

  try {
    const subs = await searchSlovenianSubs(imdbId);
    res.json({ subtitles: subs });
  } catch (err) {
    console.log("💥 Error:", err);
    res.json({ subtitles: [] });
  }
});

app.get("/", (req, res) => res.redirect("/manifest.json"));

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("  Formio Podnapisi.NET LITE RUNNING (no Puppeteer, no proxy)");
  console.log("==================================================");
});
