// ==================================================
// ✅ Formio Podnapisi.NET 🇸🇮 (v10.0.5 – stabilna verzija z boljšim parserjem)
// ==================================================
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const app = express();
app.use(cors());

const PORT = process.env.PORT || 10000;
const USERNAME = "patagero";
const PASSWORD = "Formio1978";

const normalize = s => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// ==================================================
// 🔍 Scraper funkcija
// ==================================================
async function scrapeSubtitlesByTitle(title) {
  console.log(`🎬 Iskanje slovenskih podnapisov za: ${title}`);

  // 🔄 Če obstaja prejšnja Puppeteer seja, jo zapremo
  if (globalThis.activeBrowser) {
    try {
      await globalThis.activeBrowser.close();
      console.log("🧹 Zapiram prejšnjo Chromium sejo...");
    } catch {}
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    globalThis.activeBrowser = browser;
    console.log(`🧠 Chromium zagnan iz: ${await chromium.executablePath()}`);

    const page = await browser.newPage();

    // 🔐 Prijava
    console.log("🔐 Prijava v podnapisi.net ...");
    await page.goto("https://www.podnapisi.net/sl/users/login", { waitUntil: "networkidle2" });
    await page.type("#username", USERNAME);
    await page.type("#password", PASSWORD);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2500);
    console.log("✅ Prijava uspešna");

    // 🔎 Iskanje po naslovu
    const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=sl`;
    console.log(`🌍 Iskanje: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    console.log("⏳ Čakam na rezultate iskanja ...");

    // ✅ počakamo do 15s, da se rezultati res naložijo
    try {
      await page.waitForFunction(
        () => document.querySelectorAll("a[href*='/sl/subtitles/']").length > 0,
        { timeout: 15000 }
      );
      console.log("📄 Rezultati naloženi, zajemam HTML ...");
    } catch {
      console.warn("⚠️ Rezultati niso bili vidni v 15 sekundah — poskušam vseeno.");
    }

    // ⚙️ Parser (nova struktura)
    const subtitles = await page.evaluate(() => {
      const results = [];
      const selectors = [
        ".media",
        ".subtitle-entry",
        ".card",
        ".list-group-item",
        ".search-results",
        "tr"
      ];

      const blocks = document.querySelectorAll(selectors.join(", "));
      blocks.forEach(el => {
        const linkEl =
          el.querySelector("a[href*='/sl/subtitles/']") ||
          el.querySelector(".media-heading a, .subtitle-entry__title a, .media-body a");

        const title = linkEl?.innerText?.trim() || null;
        const link = linkEl?.href || null;
        const year =
          el.querySelector(".year, .subtitle-entry__year, small")?.innerText?.trim() || null;

        if (title && link && title.length > 1) results.push({ title, link, year });
      });

      // če nič ne najde, poberi vse /sl/subtitles/
      if (results.length === 0) {
        document.querySelectorAll("a[href*='/sl/subtitles/']").forEach(a => {
          results.push({ title: a.innerText.trim(), link: a.href });
        });
      }

      return results;
    });

    console.log(`✅ Najdenih ${subtitles.length} slovenskih podnapisov`);

    // 🔎 Filtiranje po naslovu
    const normTitle = normalize(title);
    const filtered = subtitles.filter(s => {
      const t = normalize(s.title);
      return t.includes(normTitle) || normTitle.includes(t);
    });

    let finalList = filtered;
    if (filtered.length === 0) {
      console.log("⚠️ Ni ujemanj po naslovu — vračam vse slovenske rezultate.");
      finalList = subtitles;
    }

    console.log(`🧩 Po filtriranju ostane ${finalList.length} 🇸🇮 relevantnih podnapisov.`);

    // 📦 Poiščemo ZIP povezave
    for (const s of finalList) {
      try {
        const res = await fetch(s.link);
        const html = await res.text();
        const match = html.match(/https:\/\/www\.podnapisi\.net\/static\/ftp\/[^"]+\.zip/);
        if (match) {
          s.zip = match[0];
          console.log(`💾 ZIP: ${s.zip}`);
        }
      } catch {
        console.log(`⚠️ Napaka pri prenosu ZIP za ${s.title}`);
      }
    }

    await browser.close();
    globalThis.activeBrowser = null;
    await new Promise(r => setTimeout(r, 1000)); // pavza
    return finalList;
  } catch (err) {
    console.error("❌ Napaka pri scrapanju:", err);
    if (browser) await browser.close();
    globalThis.activeBrowser = null;
    return { error: "scrape_failed" };
  }
}

// ==================================================
// 📜 Manifest za Stremio
// ==================================================
app.get("/manifest.json", (req, res) => {
  res.json({
    id: "formio.podnapisinet",
    version: "10.0.5",
    name: "Formio Podnapisi.NET 🇸🇮",
    description: "Iskalnik slovenskih podnapisov (Render-safe, čaka na rezultate)",
    types: ["movie"],
    resources: [{ name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }],
    catalogs: [],
    behaviorHints: { configurable: false, configurationRequired: false },
  });
});

// ==================================================
// 🎬 Endpoint za iskanje
// ==================================================
app.get("/subtitles/movie/:query.json", async (req, res) => {
  const query = req.params.query.replace(/tt\d+/, "").trim();
  try {
    const results = await scrapeSubtitlesByTitle(query);
    res.json(results);
  } catch (err) {
    console.error("❌ Napaka pri obdelavi:", err);
    res.json({ error: "scrape_failed" });
  }
});

// ==================================================
// 🔁 Root redirect
// ==================================================
app.get("/", (req, res) => res.redirect("/manifest.json"));

// ==================================================
// 🧪 Test Puppeteer
// ==================================================
(async () => {
  try {
    console.log("🧪 Preverjam Puppeteer zagnanost...");
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
    const page = await browser.newPage();
    await page.goto("https://www.podnapisi.net/sl", { waitUntil: "domcontentloaded" });
    console.log("🧪 Puppeteer deluje — povezava uspešna.");
    await browser.close();
  } catch (err) {
    console.error("❌ Puppeteer test ni uspel:", err.message);
  }
})();

// ==================================================
// 🧠 Server listen
// ==================================================
app.listen(PORT, () => {
  console.log("==================================================");
  console.log(`✅ Formio Podnapisi.NET 🇸🇮 združena verzija posluša na portu ${PORT}`);
  console.log("==================================================");
});
