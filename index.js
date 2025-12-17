import express from "express"
import cors from "cors"

const app = express()
app.use(cors())

const PORT = process.env.PORT || 7000

// ===== MANIFEST =====
app.get("/manifest.json", (req, res) => {
  console.log("MANIFEST REQUEST from", req.ip)

  res.json({
    id: "org.test.slo-subtitles",
    version: "1.0.4", // ⚠️ VERSION BUMP
    name: "Test Slovenski Podnapisi",
    description: "Stremio subtitle addon – forced endpoints",
    resources: ["subtitles"],
    types: ["movie", "series"],
    idPrefixes: ["tt"]
  })
})

// ===== SUBTITLES (WITH .json) =====
app.get("/subtitles/:type/:id.json", (req, res) => {
  console.log("SUBTITLES (.json):", req.params)

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

// ===== SUBTITLES (WITHOUT .json) =====
app.get("/subtitles/:type/:id", (req, res) => {
  console.log("SUBTITLES (no json):", req.params)

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

// ===== CATCH ALL (DEBUG) =====
app.use((req, res) => {
  console.log("UNKNOWN REQUEST:", req.method, req.url)
  res.status(404).send("Not found")
})

// ===== START =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on port ${PORT}`)
})
