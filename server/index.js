/**
 * Express dev server for map-mvp static assets.
 * Serves files with HTTP Range support (required by PMTiles).
 * Aligns with README tech stack (Express.js backend).
 */

const express = require("express");
const path = require("path");

const app = express();
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8080);
const MAP_MVP_ROOT = path.join(__dirname, "..", "map-mvp");

app.use(
  express.static(MAP_MVP_ROOT, {
    setHeaders(res, filePath) {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Access-Control-Allow-Origin", "*");
      if (filePath.endsWith(".js") || filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

app.get("/", (_req, res) => {
  res.sendFile(path.join(MAP_MVP_ROOT, "index.html"));
});

app.listen(PORT, HOST, () => {
  console.log(`Serving ${MAP_MVP_ROOT}`);
  console.log(`Open http://${HOST}:${PORT}/ (PMTiles byte-range enabled)`);
});
