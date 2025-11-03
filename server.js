import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import AdmZip from "adm-zip";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ========================
// 📜 Manifest z nastavitvami
// ========================
const manifest = {
  id: "org.formio.podnapisi",
  version: "3.5.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Samodejno išče slovenske podnapise z možnostjo prijave v podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"],
  behaviorHints: {
    configurable: true,
    configurationRequired: false
  },
  configuration: [
    { key: "username", type: "text", name: "Uporabniško ime", description: "Uporabniško ime za podnapisi.net (neobvezno)" },
    { key: "password", type: "password", name: "Geslo", description: "Geslo za podnapisi.net (neobvezno)" }
  ]
};

// ========================
// 🗂️ Poti in datoteke
// ========================
const TMP_DIR = path.join(process.cwd(), "tmp");
const CONFIG_FILE = path.join(TMP_DIR, "config.json");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
const LOGIN_URL = "https://www.podnapisi.net/sl/login";

// ========================
// 🔒 Prijava
// ========================
async function ensureLoggedIn(page, username, password) {
  if (!username || !password) {
    console.log("🚫 Brez prijave (anonimni način).");
    return;
  }

  console.log(`🔐 Prijavljam se kot ${username} ...`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  try {
    await page.waitForSelector("form[action*='login'] input[name='username']", { timeout: 20000 });
    await page.type("input[name='username']", username, { delay: 30 });
    await page.type("input[name='password']", password, { delay: 30 });

    const loginButton =
      (await page.$("form[action*='login'] button")) ||
      (await page.$("form[action*='login'] input[type='submit']"));
    if (loginButton) await loginButton.click();

    console.log("⌛ Čakam, da se potrdi prijava ...");
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("Odjava") ||
        document.body.innerText.includes("Moj profil"),
      { timeout: 20000 }
    );
    console.log("✅ Prijava uspešna!");
  } catch (err) {
    console.log("⚠️ Napaka pri prijavi:", err.message);
  }
}

// ========================
// 🎬 IMDb → naslov
// ========================
async function getTitleFromIMDb(imdbId) {
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=thewdb`);
    const data = await res.json();
    if (data?.Title) {
      console.log(`🎬 IMDb → naslov: ${data.Title}`);
      return data.Title;
    }
  } catch {
    console.log("⚠️ Napaka IMDb API");
  }
  return imdbId;
}

// ========================
// 🧩 Zagon Chromium
// ========================
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox"],
    executablePath,
    headless: chromium.headless
  });
}

// ========================
// 🎞️ Glavna pot za podnapise
// ========================
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);

  // preberi konfiguracijo (če obstaja)
  let username = null, password = null;
  if (fs.existsSync(CONFIG_FILE)) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    username = cfg.username || null;
    password = cfg.password || null;
  }

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page, username, password);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

  try {
    await page.waitForSelector("table.table tbody tr", { timeout: 20000 });
    const html = await page.content();
    fs.writeFileSync(path.join(TMP_DIR, `${imdbId}.html`), html);

    const results = await page.$$eval("table.table tbody tr", (rows) =>
      rows.map((row) => {
        const link = row.querySelector("a[href*='/download']")?.href || null;
        const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
        return link ? { link, title } : null;
      }).filter(Boolean)
    );

    if (!results.length) {
      console.log("❌ Ni bilo najdenih slovenskih podnapisov.");
      await browser.close();
      return res.json({ subtitles: [] });
    }

    console.log(`✅ Najdenih ${results.length} slovenskih podnapisov.`);
    const subtitles = [];
    let index = 1;

    for (const r of results) {
      const downloadLink = r.link;
      const zipPath = path.join(TMP_DIR, `${imdbId}_${index}.zip`);
      const extractDir = path.join(TMP_DIR, `${imdbId}_${index}`);
      try {
        const zipRes = await fetch(downloadLink);
        const buf = Buffer.from(await zipRes.arrayBuffer());
        fs.writeFileSync(zipPath, buf);

        const zip = new AdmZip(zipPath);
        zip.extractAllTo(extractDir, true);

        const srtFile = fs.readdirSync(extractDir).find((f) => f.endsWith(".srt"));
        if (srtFile) {
          subtitles.push({
            id: `formio-podnapisi-${index}`,
            url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${index}/${encodeURIComponent(srtFile)}`,
            lang: "sl",
            name: `Formio Podnapisi.NET 🇸🇮 - ${r.title}`
          });
          console.log(`📜 Najden SRT [#${index}]: ${srtFile}`);
          index++;
        }
      } catch (err) {
        console.log(`⚠️ Napaka pri prenosu #${index}:`, err.message);
      }
    }

    await browser.close();
    res.json({ subtitles });
  } catch (err) {
    console.log("❌ Napaka pri iskanju podnapisov:", err.message);
    await browser.close();
    res.json({ subtitles: [] });
  }
});

// ⚙️ Stran za konfiguracijo (dejansko shrani nastavitve)
app.get("/configure", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Formio Podnapisi.NET - Nastavitve</title>
        <style>
          body { font-family: Arial; background:#f6f6f6; padding:40px; color:#222; }
          .box { background:white; padding:30px; border-radius:10px; max-width:400px; margin:auto; box-shadow:0 0 10px rgba(0,0,0,0.1); }
          input { width:100%; padding:10px; margin-top:8px; margin-bottom:15px; border:1px solid #ccc; border-radius:6px; font-size:16px; }
          button { background:#0066cc; color:white; border:none; padding:10px 18px; border-radius:6px; font-size:16px; cursor:pointer; }
        </style>
      </head>
      <body>
        <div class="box">
          <h2>⚙️ Nastavitve Formio Podnapisi.NET 🇸🇮</h2>
          <form method="POST" action="/configure">
            <label>Uporabniško ime</label>
            <input name="username" placeholder="Uporabniško ime" />
            <label>Geslo</label>
            <input name="password" type="password" placeholder="Geslo" />
            <button type="submit">💾 Shrani nastavitve</button>
          </form>
        </div>
      </body>
    </html>
  `);
});

app.post("/configure", (req, res) => {
  const { username, password } = req.body;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ username, password }, null, 2));
  console.log(`💾 Nastavitve shranjene za ${username || "anonimnega uporabnika"}`);
  res.send(`<html><body style="font-family:Arial;padding:40px;">✅ Nastavitve shranjene.<br><br><a href="/">Nazaj</a></body></html>`);
});

// 📂 Strežnik za datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Zagon
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon 🇸🇮 aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
