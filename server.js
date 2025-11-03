// 🔍 Iskanje podnapisov z zanesljivim nalaganjem (networkidle2 + regex fallback)
async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${searchUrl}`);

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 45000 });
  await page.waitForTimeout(3000); // dodatno varnostno čakanje

  const html = await page.content();
  let results = [];

  try {
    results = await page.$$eval("table.table tbody tr", (rows) =>
      rows.map((row) => {
        const link = row.querySelector("a[href*='/download']")?.href;
        const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
        return link ? { link, title } : null;
      }).filter(Boolean)
    );
  } catch (err) {
    console.log(`⚠️ Napaka pri branju DOM (${langCode}):`, err.message);
  }

  // če DOM ne vrne nič, uporabimo regex fallback
  if (!results.length) {
    console.log(`⌛ Ni DOM rezultatov (${langCode}), poskušam regex fallback ...`);
    const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const link = "https://www.podnapisi.net" + match[1];
      const title = match[2].trim();
      results.push({ link, title });
    }
  }

  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  return results.map((r, i) => ({ ...r, lang: langCode, index: i + 1 }));
}
