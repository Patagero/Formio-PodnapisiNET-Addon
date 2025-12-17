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
    version: "1.0.2", // ⚠️ VERSION BUMP – OBVEZNO
    name: "Test Slovenski Podnapisi",
    description: "Testni Stremio subtitle addon (force enabled)",
    resources: ["subtitles"],
    types: ["movie", "series"],   // ⚠️ razširjeno
    idPrefixes: ["tt"]            // IMDB
  })
})

// ===== SUBTITLES =====
app.get("/subtitles/:type/:id.json", (req, res) => {
  const { type, id } = req.params

  console.log("SUBTITLES REQUEST:", type, id, "from", req.ip)

  res.json({
    subtitles: [
      {
        id: "test-slo",
        lang: "sl",
        url: "https://raw.githubusercontent.com/andreyvit/subtitle-tools/master/sample.srt"
      }
    ]
  })
})

// ===== ROOT (za debug) =====
app.get("/", (req, res) => {
  res.send("Stremio subtitle addon is running")
})

// ===== START =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on http://0.0.0.0:${PORT}`)
})
