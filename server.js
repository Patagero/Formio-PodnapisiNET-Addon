async function fetchSubtitlesForLang(browser, title, langCode) {
  const page = await browser.newPage();
  const url = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(title)}&language=${langCode}`;
  console.log(`🌍 Iščem (${langCode}): ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // počakaj, da se pojavi tabela ali da mine max 15 sekund
  try {
    await page.waitForFunction(
      () => document.querySelectorAll("table.table tbody tr").length > 0,
      { timeout: 15000, polling: 500 }
    );
  } catch {
    console.log(`⚠️ Rezultati za ${langCode} se niso pojavili pravočasno — poskušam AJAX fallback.`);
  }

  // poizkusi scroll sprožiti nalaganje (včasih potreben trigger)
  await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));

  // še dodatno počakaj, če se ravno zdaj nalagajo rezultati
  await new Promise(r => setTimeout(r, 2000));

  const html = await page.content();
  const results = await page.$$eval("table.table tbody tr", (rows) =>
    rows.map((row) => {
      const link = row.querySelector("a[href*='/download']")?.href;
      const title = row.querySelector("a[href*='/download']")?.innerText?.trim() || "Neznan";
      return link ? { link, title } : null;
    }).filter(Boolean)
  );

  if (results.length === 0) {
    // fallback: regex iz HTML vsebine (če DOM še ni naložen)
    const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      results.push({
        link: "https://www.podnapisi.net" + match[1],
        title: match[2].trim(),
        lang: langCode
      });
    }
  }

  console.log(`✅ Najdenih ${results.length} (${langCode})`);
  await page.close();
  return results.map((r, i) => ({ ...r, lang: langCode, index: i + 1 }));
}
