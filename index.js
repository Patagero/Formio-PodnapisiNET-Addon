import express from "express"
import cors from "cors"

const app = express()
app.use(cors())

const PORT = process.env.PORT || 7000

// ===== MANIFEST =====
app.get("/manifest.json", (req, res) => {
  console.log("MANIFEST REQUEST")

  res.json({
    id: "org.test.force-subtitles",
    version: "1.1.0", // ⚠️ BUMP
    name: "Test Force Subtitles",
    description: "Forces Stremio to call subtitle addons",
    resources: ["subtitles", "streams"], // 🔥 KLJUČNO
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  })
})

// ===== DUMMY STREAMS =====
app.get("/streams/:type/:id.json", (req, res) => {
  console.log("STREAMS REQUEST:", req.params)

  // Namerno vrnemo PRAZEN seznam
  res.json({
    streams: []
  })
})

// ===== SUBTITLES (.json) =====
app.get("/subtitles/:type/:id.json", (req, res) => {
  console.log("SUBTITLES REQUEST (.json):", req.params)

  res.json({
    subtitles: [
      {
        id: "test-eng",
        lang: "eng",
        url: "https://raw.githubusercontent.com/andreyvit/subtitle-tools/master/sample.srt"
      }
    ]
  })
})

// ===== SUBTITLES (no .json) =====
app.get("/subtitles/:type/:id", (req, res) => {
  console.log("SUBTITLES REQUEST (no json):", req.params)

  res.json({
    subtitles: [
      {
        id: "test-eng",
        lang: "eng",
        url: "https://raw.githubusercontent.com/andreyvit/subtitle-tools/master/sample.srt"
      }
    ]
  })
})

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`)
})
