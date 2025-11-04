// ... [vse tvoje obstoječe funkcije do zadnjega bloka ostanejo enake]

      if (srtFile) {
        subtitles.push({
          id: `formio-podnapisi-${idx}`,
          url: `https://formio-podnapisinet-addon-1.onrender.com/files/${imdbId}_${idx}/${encodeURIComponent(srtFile)}`,
          lang: r.lang,
          name: `${flag} ${r.title}`
        });
        console.log(`📜 [${r.lang}] ${srtFile}`);
        idx++;
      }
    } catch (err) {
      console.log(`⚠️ Napaka pri prenosu #${idx}:`, err.message);
    }
  }

  cache[imdbId] = { timestamp: Date.now(), data: subtitles };
  saveCache(cache);
  res.json({ subtitles });
});

// 📂 Strežnik za dostop do prenesenih datotek
app.get("/files/:id/:file", (req, res) => {
  const filePath = path.join(TMP_DIR, req.params.id, req.params.file);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("Subtitle not found");
  }
});

// 📄 Manifest za Stremio
app.get("/manifest.json", (req, res) => {
  res.json(manifest);
});

// 🚀 Zagon strežnika
const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log("==================================================");
  console.log("✅ Formio Podnapisi.NET 🇸🇮 aktiven (razširjen filter + prijava + log izločitev)");
  console.log(`🌐 Manifest: http://127.0.0.1:${PORT}/manifest.json`);
  console.log("==================================================");
});
