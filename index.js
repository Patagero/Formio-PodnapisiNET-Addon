import express from "express";
import cors from "cors";
import unzipper from "unzipper";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 7000;

/* =====================
   LOG (debug)
===================== */
app.use((req, res, next) => {
  const ip =
    req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
    req.socket.remoteAddress;

  console.log(
    "REQ",
    req.method,
    req.url,
    "| ip:",
    ip,
    "| ua:",
    req.headers["user-agent"] || "-"
  );
  next();
});

/* =====================
   MANIFEST
===================== */
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "org.podnapisi.sl",
    version: "2.2.0", // 🔥 FINAL FIX
    name: "Podnapisi.NET (Slovenščina)",
    description: "Slovenski podnapisi iz Podnapisi.NET (proxy, unzip, stable)",
    resources: [
      { name: "stream", types: ["movie"], idPrefixes: ["tt"] },
      { name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }
    ],
    types: ["movie"],
    idPrefixes: ["tt"]
  });
});

/* =====================
   DUMMY STREAM
===================== */
app.get("/stream/:type/:id", (req, res) => {
  res.json({ streams: [] });
});
app.get("/stream/:type/:id.json", (req, res) => {
  res.json({ streams: [] });
});

/* =====================
   SUBTITLES (Stremio → addon)
===================== */
app.get("/subtitles/:type/:id/*", (req, res) => {
  const { id } = req.params;

  // TEST: Titanic (1997)
  if (id === "tt0120338") {
    return res.json({
      subtitles: [
        {
          id: "podnapisi-dgji",
          lang: "slv",
          url: `https://${req.headers.host}/subtitle/DGJI.srt`
        }
      ]
    });
  }

  res.json({ subtitles: [] });
});

/* =====================
   PROXY: Podnapisi.NET ZIP → SRT
===================== */
app.get("/subtitle/DGJI.srt", async (req, res) => {
  try {
    // ⚠️ PRAVI URL (JEZIK JE OBVEZEN)
    const zipUrl = "https://www.podnapisi.net/sl/subtitles/download/DGJI";

    const response = await fetch(zipUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.podnapisi.net/sl/"
      }
    });

    if (!response.ok) {
      return res.status(500).send("Failed to fetch subtitle ZIP");
    }

    const contentType = response.headers.get("content-type") || "";

    // Če Podnapisi vrne HTML (login / redirect), ne ZIP
    if (!contentType.includes("zip")) {
      const preview = (await response.text()).slice(0, 200);
      console.error("NOT ZIP RESPONSE:", preview);
      return res.status(500).send("Podnapisi.NET did not return ZIP");
    }

    // 🔥 BUFFER UNZIP – najbolj stabilno
    const buffer = Buffer.from(await response.arrayBuffer());
    const directory = await unzipper.Open.buffer(buffer);

    const srtFile = directory.files.find(f =>
      f.path.toLowerCase().endsWith(".srt")
    );

    if (!srtFile) {
      return res.status(404).send("SRT not found in ZIP");
    }

    res.setHeader("Content-Type", "application/x-subrip");
    srtFile.stream().pipe(res);

  } catch (err) {
    console.error("SUBTITLE PROXY ERROR:", err);
    res.status(500).send("Subtitle proxy error");
  }
});

/* =====================
   START
===================== */
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`);
});
