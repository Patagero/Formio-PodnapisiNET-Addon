// 🔍 Pridobi slovenske podnapise (z globokim čakanjem in XHR interceptom)
async function fetchSubtitles(browser, title) {
  const page = await browser.newPage();
  const searchUrl = `https://www.podnapisi.net/sl/subtitles/search/?keywords=${encodeURIComponent(
    title
  )}&language=sl`;
  console.log(`🌍 Iščem 🇸🇮: ${searchUrl}`);

  let ajax = null;
  page.on("response", async (r) => {
    const url = r.url();
    if (url.includes("/api/subtitles/search") && r.status() === 200) {
      try {
        ajax = await r.json();
      } catch {}
    }
  });

  await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 60000 });

  // 🔁 počakaj do 15 sekund, če pride AJAX odgovor
  for (let i = 0; i < 30 && !ajax; i++) {
    await new Promise((r) => setTimeout(r, 500));
    // scrollamo, da sprožimo lazy-load
    await page.evaluate(() => window.scrollBy(0, 300));
  }

  let results = [];

  // ✅ 1. Če API že vrne rezultate
  if (ajax?.subtitles?.length) {
    console.log(`✅ Najdenih ${ajax.subtitles.length} 🇸🇮 (API način)`);
    results = ajax.subtitles.map((s, i) => ({
      link: "https://www.podnapisi.net" + s.url,
      title: s.release || s.title || "Neznan",
      index: i + 1,
    }));
  } else {
    // 🧩 2. Če ni AJAX, poskusi počakati na DOM elemente
    try {
      await page.waitForSelector("div.subtitle-card a[href*='/download'], table.table a[href*='/download']", { timeout: 20000 });
    } catch {
      console.log("⌛ Čakanje na DOM se je izteklo – preklapljam na regex.");
    }

    // 📋 Preberi vsa sidra
    results = await page.$$eval(
      "div.subtitle-card a[href*='/download'], table.table a[href*='/download']",
      (links) =>
        links.map((a, i) => ({
          link: a.href,
          title: a.innerText.trim(),
          index: i + 1,
        }))
    );

    // 🧠 3. Regex fallback (če DOM prazen)
    if (!results.length) {
      const html = await page.content();
      const regex = /href="([^"]*\/download)"[^>]*>([^<]+)<\/a>/g;
      let match;
      while ((match = regex.exec(html)) !== null) {
        const link = "https://www.podnapisi.net" + match[1];
        const subTitle = match[2].trim();
        if (subTitle) results.push({ link, title: subTitle });
      }
    }

    if (results.length)
      console.log(`✅ Najdenih ${results.length} 🇸🇮 (DOM/regex način)`);
    else console.log("⚠️ Ni slovenskih rezultatov (po vseh metodah)");
  }

  await page.close();
  return results;
}
