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
    version: "1.0.0",
    name: "Test Slovenski Podnapisi",
    description: "Minimalni testni subtitle addon",
    resources: ["subtitles"],
    types: ["movie"],
    idPrefixes: ["tt"]
  })
})

// ===== SUBTITLES =====
app.get("/subtitles/:type/:id.json", (req, res) => {
  const { type, id } = req.params

  console.log("SUBTITLE REQUEST:", type, id, "from", req.ip)

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

// ===== START =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Addon running on http://0.0.0.0:${PORT}`)
})
