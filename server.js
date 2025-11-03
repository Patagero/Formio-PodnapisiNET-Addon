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

const manifest = {
  id: "org.formio.podnapisi",
  version: "3.4.0",
  name: "Formio Podnapisi.NET 🇸🇮",
  description: "Samodejno išče slovenske podnapise s prijavo uporabnika v podnapisi.net",
  logo: "https://www.podnapisi.net/favicon.ico",
  types: ["movie", "series"],
  resources: ["subtitles"],
  idPrefixes: ["tt"],
  behaviorHints: {
    configurable: true,
    configurationRequired: true,
  },
  configuration: [
    {
      key: "username",
      type: "text",
      name: "Uporabniško ime",
      description: "Vnesi svoje uporabniško ime za podnapisi.net",
    },
    {
      key: "password",
      type: "password",
      name: "Geslo",
      description: "Vnesi svoje geslo za podnapisi.net",
    },
  ],
};

const TMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const LOGIN_URL = "https://www.podnapisi.net/sl/login";

// 🔒 prijava v podnapisi.net (uporablja podatke iz settings)
async function ensureLoggedIn(page, username, password) {
  const cookiesPath = path.join(TMP_DIR, "cookies.json");

  if (fs.existsSync(cookiesPath)) {
    const cookies = JSON.parse(fs.readFileSync(cookiesPath, "utf8"));
    await page.setCookie(...cookies);
    console.log("🍪 Uporabljeni shranjeni piškotki (login preskočen).");
    return;
  }

  if (!username || !password) {
    console.log("⚠️ Uporabniško ime ali geslo ni podano — prijava preskočena.");
    return;
  }

  console.log(`🔐 Prijavljam se kot '${username}' ...`);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  try {
    await page.waitForSelector("form[action*='login'] input[name='username']", { timeout: 20000 });
    await page.type("input[name='username']", username, { delay: 25 });
    await page.type("input[name='password']", password, { delay: 25 });

    const loginButton =
      (await page.$("form[action*='login'] button")) ||
      (await page.$("form[action*='login'] input[type='submit']"));
    if (loginButton) await loginButton.click();

    console.log("⌛ Čakam, da se potrdi prijava ...");
    await page.waitForFunction(
      () => {
        const text = document.body.innerText;
        return text.includes("Odjava") || text.includes("Moj profil") || text.includes(username);
      },
      { timeout: 30000 }
    );

    console.log("✅ Prijava uspešna (prepoznan uporabnik).");
    const cookies = await page.cookies();
    fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
  } catch (err) {
    console.log("⚠️ Napaka pri prijavi:", err.message);
  }
}

// 🔎 IMDb → naslov
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

// 🔧 zagon Chromium
async function getBrowser() {
  const executablePath = await chromium.executablePath();
  return puppeteer.launch({
    args: [...chromium.args, "--no-sandbox"],
    executablePath,
    headless: chromium.headless,
  });
}

// 🧩 Glavna pot za podnapise
app.get("/subtitles/:type/:id/:extra?.json", async (req, res) => {
  const imdbId = req.params.id;
  const username = req.query.username;
  const password = req.query.password;

  console.log("==================================================");
  console.log("🎬 Prejemam zahtevo za IMDb:", imdbId);
  if (username) console.log(`👤 Uporabnik: ${username}`);
  else console.log("⚠️ Brez uporabniškega imena — delujem brez prijave");

  const title = await getTitleFromIMDb(imdbId);
  const query = encodeURIComponent(title);
  const browser = await getBrowser();
  const page = await browser.newPage();
  await ensureLoggedIn(page, username, password);

  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${query}&language=sl`;
  console.log(`🌍 Iščem slovenske podnapise: ${searchUrl}`);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded" });

  try {
    await page.waitForSelector("table.table tbody tr", { timeout: 20000 });

    const results = await page.$$eval("table.table tbody tr", (rows) =>
      rows
        .map((row) => {
          const link = row.querySelector("a[href*='/download']")?.href || null;
          const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
          return link ? { link, title } : null;
        })
        .filter(Boolean)
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
            url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${index}/${encodeURIComponent(
              srtFile
            )}`,
            lang: "sl",
            name: `🇸🇮 ${r.title}`,
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

// 📂 Strežnik za datoteke
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).send("Subtitle not found");
});

// 📜 Manifest
app.get("/manifest.json", (req, res) => res.json(manifest));

// 🚀 Zagon strežnika
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET Addon 🇸🇮 aktiven!");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
