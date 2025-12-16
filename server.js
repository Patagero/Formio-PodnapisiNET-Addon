import express from "express";
import fetch from "node-fetch";
import cheerio from "cheerio";
import unzipper from "unzipper";
import cors from "cors";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;

/* ===========================
   UTIL: clean filename → title
=========================== */
function cleanTitle(filename = "") {
    return filename
        .replace(/\.[^.]+$/, "")          // remove extension
        .replace(/\d{4}/g, "")             // remove year
        .replace(/2160p|1080p|720p/gi, "")
        .replace(/BDRemux|BRRip|WEBRip|HDR|DV|x265|x264/gi, "")
        .replace(/[._]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

/* ===========================
   MANIFEST
=========================== */
app.get("/manifest.json", (req, res) => {
    res.json({
        id: "org.formio.podnapisi",
        version: "1.0.0",
        name: "Podnapisi.NET 🇸🇮",
        description: "Slovenski podnapisi iz Podnapisi.NET",
        resources: ["subtitles"],
        types: ["movie", "series"],
        idPrefixes: ["tt"]
    });
});

/* ===========================
   STREMIO SUBTITLES ENDPOINT
=========================== */
app.get("/subtitles/:type/:imdb/:rest.json", async (req, res) => {
    try {
        const imdb = req.params.imdb;
        const filename = req.query.filename || "";

        console.log("🎬 STREMIO REQUEST");
        console.log("IMDB:", imdb);
        console.log("FILENAME:", filename);

        const title = cleanTitle(filename);
        console.log("🔍 SEARCH TITLE:", title);

        if (!title) {
            return res.json({ subtitles: [] });
        }

        const searchUrl =
            "https://www.podnapisi.net/sl/subtitles/search/?" +
            new URLSearchParams({
                keywords: title,
                language: "sl"
            }).toString();

        console.log("🌍 FETCH:", searchUrl);

        const html = await fetch(searchUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        }).then(r => r.text());

        const $ = cheerio.load(html);
        const results = [];

        $(".subtitle-entry").each((i, el) => {
            const link = $(el).find("a").attr("href");
            const name = $(el).find(".subtitle-title").text().trim();

            if (link && name) {
                results.push({
                    id: link.split("/").pop(),
                    url: "https://www.podnapisi.net" + link,
                    lang: "sl",
                    title: name
                });
            }
        });

        console.log("➡️ FOUND:", results.length);

        const subtitles = [];

        for (const sub of results.slice(0, 5)) {
            try {
                const zipUrl = sub.url + "/download";

                const zipRes = await fetch(zipUrl, {
                    headers: { "User-Agent": "Mozilla/5.0" }
                });

                const zip = zipRes.body.pipe(unzipper.Parse({ forceStream: true }));

                for await (const entry of zip) {
                    if (entry.path.endsWith(".srt")) {
                        const content = await entry.buffer();
                        subtitles.push({
                            id: sub.id,
                            lang: "sl",
                            content: content.toString("utf-8"),
                            title: sub.title
                        });
                        break;
                    } else {
                        entry.autodrain();
                    }
                }
            } catch (e) {
                console.log("⚠️ ZIP FAIL:", sub.url);
            }
        }

        console.log("✅ RETURNING:", subtitles.length);
        res.json({ subtitles });

    } catch (err) {
        console.error("❌ ERROR:", err);
        res.json({ subtitles: [] });
    }
});

/* ===========================
   START
=========================== */
app.listen(PORT, () => {
    console.log("🔥 ADDON RUNNING ON", PORT);
});
