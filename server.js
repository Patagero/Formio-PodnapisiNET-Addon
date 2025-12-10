import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());

const BASE = "https://www.podnapisi.net";
const HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept-Language": "sl"
};

// -----------------------
//  SEARCH BY TITLE
// -----------------------
async function searchSubtitles(title) {
    const url = `${BASE}/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
    console.log("🔍 SEARCH URL:", url);

    const res = await fetch(url, { headers: HEADERS });
    const html = await res.text();
    const $ = cheerio.load(html);

    const entries = $(".subtitle-entry");
    console.log("➡ Najdenih:", entries.length);

    const results = [];

    entries.each((i, el) => {
        const a = $(el).find("a");
        const href = a.attr("href");
        if (!href) return;

        const full = BASE + href;
        const id = href.split("/").pop();

        results.push({
            id,
            name: a.text().trim(),
            url: full
        });
    });

    return results;
}

// -----------------------
//  DOWNLOAD ZIP + EXTRACT SRT
// -----------------------
async function getSubtitleSRT(subUrl) {
    console.log("⬇ PRIDOBIVAM:", subUrl);

    const page = await fetch(subUrl, { headers: HEADERS });
    const html = await page.text();
    const $ = cheerio.load(html);

    const btn = $("a.btn-download");
    if (!btn.length) {
        console.log("❌ ZIP BUTTON NOT FOUND");
        return null;
    }

    const zipUrl = BASE + btn.attr("href");
    console.log("📦 ZIP:", zipUrl);

    const zipRes = await fetch(zipUrl, { headers: HEADERS });
    const zipBuf = Buffer.from(await zipRes.arrayBuffer());

    try {
        const zip = new AdmZip(zipBuf);
        const entries = zip.getEntries();

        for (const e of entries) {
            if (e.entryName.endsWith(".srt")) {
                console.log("📄 Extract:", e.entryName);
                return zip.readAsText(e);
            }
        }
    } catch (err) {
        console.log("❌ ZIP EXTRACT ERROR:", err);
    }

    return null;
}

// -----------------------
//  MANIFEST
// -----------------------
app.get("/manifest.json", (req, res) => {
    res.json({
        id: "org.formio.podnapisi",
        version: "1.0.0",
        name: "Podnapisi.NET Stremio Addon",
        description: "Slovenski podnapisi iz Podnapisi.NET",
        types: ["movie", "series"],
        idPrefixes: ["tt"],
        resources: ["subtitles"]
    });
});

// -----------------------
//  SUBTITLES ENDPOINT
// -----------------------
app.get("/subtitles/:type/:imdb.json", async (req, res) => {
    const filename = req.query.filename;
    if (!filename) return res.json({ subtitles: [] });

    const clean = filename.split(".")[0];
    console.log("🎬 CLEAN TITLE:", clean);

    const results = await searchSubtitles(clean);
    const output = [];

    for (const r of results) {
        const srt = await getSubtitleSRT(r.url);
        if (!srt) continue;

        output.push({
            id: r.id,
            lang: "sl",
            name: r.name,
            url: r.url,
            subtitles: srt
        });
    }

    console.log("✅ POSLANO:", output.length);
    res.json({ subtitles: output });
});

// -----------------------
//  START SERVER
// -----------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🔥 RUNNING ON ${PORT}`));
