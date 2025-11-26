import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";

const app = express();
app.use(cors());
app.use(express.json());

const manifest = {
  id: "org.formio.podnapisi",
  version: "7.0.0",
  name: "Formio Podnapisi.NET 🇸🇮 (LITE)",
  description: "Stabilna verzija brez Puppeteer – samo slovenski podnapisi",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"]
};

async function getTitleFromIMDb(imdbId) {
  try {
    const r = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const d = await r.json();
    if (d?.Title) return d.Title;
  } catch {}
  return imdbId;
}

async function searchSlovenianSubs(imdbId) {
  const title = await getTitleFromIMDb(imdbId);
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;

  const page = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "sl,en;q=0.8"
    }
  });
  const html = await page.text();
  const $ = cheerio.load(html);

  const results = [];

  $("table.table tbody tr").each((i, row) => {
    const a = $(row).find("a[href*='/download'], a[href*='/subtitles/']").first();
    const href = a.attr("href");
    const name = a.text().trim();

    if (!href || !name) return;

    const link = href.startsWith("http")
      ? href
      : `https://www.podnapisi.net${href}`;

    results.push({
      id: `slo-${i + 1}`,
      lang: "sl",
      url: link,
      title: `${name} 🇸🇮`
    });
  });

  return results;
}

app.get("/manifest.json", (req, res) => res.json(manifest));

app.get("/subtitles/:type/:imdbId/:extra?.json", async (req, res) => {
  const imdbId = req.params.imdbId;

  try {
    const subs = await searchSlovenianSubs(imdbId);
    res.json({ subtitles: subs });
  } catch (err) {
    console.log("ERROR", err);
    res.json({ subtitles: [] });
  }
});

app.get("/", (req, res) => res.redirect("/manifest.json"));

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log(" Formio Podnapisi (LITE) running on port:", PORT);
  console.log("==================================================");
});
