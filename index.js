import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { addonBuilder } from "stremio-addon-sdk";

const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.PUBLIC_URL || "http://localhost:" + PORT;

const app = express();
app.use(cors());

/* ================= MANIFEST ================= */

const manifest = {
  id: "org.stremio.kodi.bridge.stream",
  version: "1.0.0",
  name: "Kodi Bridge (with metadata)",
  description: "Wraps stream URLs so Kodi receives title + imdb",
  resources: ["streams"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

const builder = new addonBuilder(manifest);

/* ================= STREAM HANDLER ================= */

builder.defineStreamHandler(async ({ type, id, extra }) => {
  const imdb = id; // tt....
  const meta = extra?.meta || {};

  const title = meta.name || meta.title || "Unknown";
  const year = meta.year || "";

  // ⚠️ Tu pričakujemo, da Stremio že ima stream URL
  // (če uporabljaš RD / Torrentio, bo to delovalo)
  if (!extra?.url) return { streams: [] };

  const wrapped = `${BASE_URL}/play` +
    `?imdb=${encodeURIComponent(imdb)}` +
    `&title=${encodeURIComponent(title)}` +
    `&year=${year}` +
    `&type=${type}` +
    `&season=${extra.season || ""}` +
    `&episode=${extra.episode || ""}` +
    `&url=${encodeURIComponent(extra.url)}`;

  return {
    streams: [{
      name: "▶ Play in Kodi (with metadata)",
      title: `${title} ${year}`,
      url: wrapped
    }]
  };
});

/* ================= PLAY ENDPOINT ================= */

app.get("/play", async (req, res) => {
  const streamUrl = req.query.url;
  if (!streamUrl) return res.status(400).send("Missing stream URL");

  // Kodi bo ta URL dobil – metadata ostane v queryju
  res.redirect(streamUrl);
});

/* ================= START ================= */

app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

app.use("/", builder.getInterface());

app.listen(PORT, () => {
  console.log("Kodi Bridge Stream Addon running on", PORT);
});