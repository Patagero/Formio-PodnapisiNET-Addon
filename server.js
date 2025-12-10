import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";   // <-- FIXED

const app = express();
app.use(cors());

// -------------------------
// MANIFEST
// -------------------------
app.get("/manifest.json", (req, res) => {
    res.json({
        id: "org.formio.podnapisi",
        version: "1.0.0",
        name: "Podnapisi.NET Stremio Addon",
        description: "Slovenski podnapisi iz Podnapisi.NET",
        types: ["movie", "series"],
        idPrefixes: ["tt"],
        resources: ["subtitles"],
    });
});

// -------------------------
// SCRAPER
// -------------------------
async function searchSubtitles(title) {
    try {
        const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;

        console.log("🔍 FETCH PAGE:", url);

        const html = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" }
        }).then(r => r.text());

        const $ = cheerio.load(html);

        let out = [];

        $(".subtitle-entry").each((i, el) => {
            const link = $(el).find("a:first").attr("href");
            const name = $(el).find("a:first").text().trim();

            if (!link) return;

            out.push({
                id: link.split("/").pop(),
                title: name,
                download: `https://www.podnapisi.net${link}/download`
            });
        });

        console.log(`➡️ Najdenih ${out.length} podnapisov`);
        return out;

    } catch (err) {
        console.error("❌ SCRAPE ERROR:", err);
        return [];
    }
}

// -------------------------
// DOWNLOAD (EXTRACT .SRT)
// -------------------------
app.get("/download", async (req, res) => {
    try {
        const zipUrl = req.query.url;
        if (!zipUrl) return res.status(400).send("Missing url parameter");

        console.log("⬇ DOWNLOADING ZIP:", zipUrl);

        const buf = await fetch(zipUrl, {
            headers: { "User-Agent": "Mozilla/5.0" }
        }).then(r => r.buffer());

        const zip = new AdmZip(buf);
        const entries = zip.getEntries();

        for (const entry of entries) {
            if (entry.entryName.toLowerCase().endsWith(".srt")) {
                const srt = zip.readAsText(entry);
                res.setHeader("Content-Type", "text/plain; charset=utf-8");
                return res.send(srt);
            }
        }

        return res.status(404).send("SRT not found");

    } catch (err) {
        console.error("❌ DOWNLOAD ERROR:", err);
        res.status(500).send("Internal error");
    }
});

// -------------------------
// SUBTITLES ENDPOINT
// -------------------------
app.get("/subtitles/:type/:imdb.json", async (req, res) => {
    const imdb = req.params.imdb;
    const filename = req.query.filename || "";
    const cleanTitle = filename.replace(/\./g, " ").replace(/\b\d{3,4}p\b/gi, "").trim();

    const title = cleanTitle || imdb;

    console.log("🎬 CLEAN TITLE:", title);

    const results = await searchSubtitles(title);

    const out = results.map(sub => ({
        id: sub.id,
        lang: "sl",
        url: `${req.protocol}://${req.get("host")}/download?url=${encodeURIComponent(sub.download)}`
    }));

    res.json({ subtitles: out });
});

// -------------------------
// START SERVER
// -------------------------
const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log("✅ ADDON RUNNING ON PORT", PORT);
});
