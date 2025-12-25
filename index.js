import http from "http";
import https from "https";
import { URL } from "url";

const PORT = process.env.PORT || 10000;

/* ================= MANIFEST ================= */

const manifest = {
  id: "org.formio.podnapisi.filename",
  version: "4.0.0",
  name: "Podnapisi.NET (filename / title)",
  description: "Podnapisi.NET HTML search (a4k-style logic)",
  resources: ["subtitles"],
  types: ["movie", "series"],
  idPrefixes: ["tt"]
};

/* ================= HELPERS ================= */

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "sl,en-US;q=0.8,en;q=0.7",
  "Connection": "keep-alive"
};

async function fetchText(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function fetchBuffer(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ================= PODNAPISI SEARCH ================= */

async function searchPodnapisi(title) {
  const q = encodeURIComponent(title);
  const url = `https://www.podnapisi.net/sl/ppodnapisi/search?keywords=${q}`;

  console.log("🔍 Searching Podnapisi.NET for:", title);

  const html = await fetchText(url);

  const matches = [...html.matchAll(/href="\/subtitles\/([A-Za-z0-9]+)"/g)];

  return [...new Set(matches.map(m => m[1]))].slice(0, 5);
}

async function resolveDownloadLink(id) {
  const html = await fetchText(`https://www.podnapisi.net/subtitles/${id}`);

  const m = html.match(/href="(\/subtitles\/download\/[^"]+)"/);
  if (!m) throw new Error("Download link not found");

  return `https://www.podnapisi.net${m[1]}`;
}

/* ================= HTTP SERVER ================= */

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);

    /* ---------- manifest ---------- */
    if (u.pathname === "/manifest.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(manifest));
    }

    /* ---------- subtitles ---------- */
    const m = u.pathname.match(/^\/subtitles\/(movie|series)\/(tt\d+)/);
    if (m) {
      const imdb = m[2];

      // minimal IMDB → TITLE mapping (DEMO)
      const TITLE_MAP = {
        tt0137523: "Fight Club",
        tt0903747: "Breaking Bad"
      };

      const title = TITLE_MAP[imdb];
      if (!title) {
        return res.end(JSON.stringify({ subtitles: [] }));
      }

      const ids = await searchPodnapisi(title);

      const subtitles = ids.map(id => ({
        id,
        lang: "sl",
        format: "srt",
        url: `https://${req.headers.host}/download/${id}`
      }));

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ subtitles }));
    }

    /* ---------- download ---------- */
    const d = u.pathname.match(/^\/download\/([A-Za-z0-9]+)/);
    if (d) {
      const id = d[1];
      const link = await resolveDownloadLink(id);
      const buf = await fetchBuffer(link);

      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${id}.zip"`
      });
      return res.end(buf);
    }

    /* ---------- root ---------- */
    res.writeHead(200);
    res.end("Podnapisi.NET filename addon running");

  } catch (e) {
    console.error("❌ ERROR:", e.message);
    res.writeHead(500);
    res.end("Error");
  }
});

server.listen(PORT, () =>
  console.log(`✅ Podnapisi.NET filename addon running on ${PORT}`)
);