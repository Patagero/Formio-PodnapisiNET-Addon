import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";   // <-- FIXED
import AdmZip from "adm-zip";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/manifest.json", (req, res) => {
    res.json({
        id: "org.formio.podnapisi",
        version: "1.0.0",
        name: "Podnapisi.NET",
        description: "Slovenski podnapisi iz Podnapisi.NET",
        idPrefixes: ["tt"],
        types: ["movie", "series"],
        resources: [
            { name: "subtitles", types: ["movie", "series"] }
        ]
    });
});

// Clean title to simple searchable form
function cleanFilename(name) {
    return name
        .replace(/\./g, " ")
        .replace(/\d{3,4}p/gi, "")
        .replace(/BDRemux|BluRay|x264|x265|HEVC|HDR|SDR|AAC|DTS|WEBRip|WEB-DL|Remastered/gi, "")
        .trim();
}

app.get("/subtitles/:type/:id.json", async (req, res) => {
    const imdb = req.params.id;
    const filename = req.query.filename || "";
    const clean = cleanFilename(filename);

    console.log("🎬 IMDb:", imdb);
    console.log("🎬 Filename:", filename);
    console.log("🎬 Clean title:", clean);

    const searchURL =
        "https://www.podnapisi.net/sl/subtitles/search/?keywords=" +
        encodeURIComponent(clean) +
        "&language=sl";

    console.log("🔍 Searching:", searchURL);

    let html;
    try {
        const response = await fetch(searchURL, {
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        html = await response.text();
    } catch (e) {
        console.log("❌ Fetch error:", e);
        return res.json({ subtitles: [] });
    }

    const $ = cheerio.load(html);
    let results = [];

    $(".subtitle-entry").each((i, el) => {
        const link = $(el).find("a").attr("href");
        if (link) {
            results.push("https://www.podnapisi.net" + link + "/download");
        }
    });

    console.log(➡️ Found:", results.length);

    if (results.length === 0) {
        return res.json({ subtitles: [] });
    }

    const zipURL = results[0];
    console.log("⬇ ZIP:", zipURL);

    let srtText = "";
    try {
        const zipData = await fetch(zipURL, {
            headers: { "User-Agent": "Mozilla/5.0" }
        }).then(r => r.arrayBuffer());

        const zip = new AdmZip(Buffer.from(zipData));
        const entries = zip.getEntries();

        for (const entry of entries) {
            if (entry.entryName.toLowerCase().endsWith(".srt")) {
                srtText = zip.readAsText(entry);
                break;
            }
        }
    } catch (err) {
        console.log("❌ ZIP extraction error:", err);
        return res.json({ subtitles: [] });
    }

    if (!srtText) {
        console.log("❌ No .srt found");
        return res.json({ subtitles: [] });
    }

    const srtId = Buffer.from(srtText).toString("base64");

    return res.json({
        subtitles: [
            {
                id: imdb,
                lang: "sl",
                url: `data:text/plain;base64,${srtId}`
            }
        ]
    });
});

app.listen(PORT, () => console.log("🔥 ADDON RUNNING ON", PORT));
