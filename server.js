// 🔍 Fuzzy + precizni filter
const filteredResults = (() => {
  const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const notSeries = slResults.filter(r => {
    const n = r.title.toLowerCase();
    return !(n.includes("s0") || n.includes("e0") || n.includes("episode") || n.includes("series") || n.includes("lois"));
  });

  function similar(a, b) {
    a = a.toLowerCase().replace(/[^a-z0-9]+/g, "");
    b = b.toLowerCase().replace(/[^a-z0-9]+/g, "");
    let mismatches = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) if (a[i] !== b[i]) mismatches++;
    mismatches += Math.abs(a.length - b.length);
    return mismatches <= 6;
  }

  console.log("🔍 Naslov IMDb:", cleanTitle);
  for (const r of notSeries) console.log("   ↳ preverjam:", r.title);

  const withYear = year
    ? notSeries.filter(r => similar(r.title, cleanTitle) && r.title.includes(year))
    : [];

  // Če najdemo z letnico – vzemi samo te
  if (withYear.length > 0) return withYear;

  // Glavni filter — mora se ZAČETI z iskanim naslovom ali biti zelo podoben
  const closeMatches = notSeries.filter(r => {
    const t = r.title.toLowerCase();
    const normalized = t.replace(/[^a-z0-9]+/g, "");
    const strongMatch =
      normalized.startsWith(cleanTitle) || // začne z istim imenom
      t.split(/[.\s]/)[0] === cleanTitle || // prva beseda se ujema
      similar(t, cleanTitle);
    const wrongPhrase = /(saints|and|land|lois|series|episode)/.test(t);
    return strongMatch && !wrongPhrase;
  });

  if (closeMatches.length > 0) return closeMatches;

  return notSeries.filter(r => r.title.toLowerCase().includes(title.toLowerCase()));
})();
