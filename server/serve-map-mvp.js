/**
 * Express dev server for map-mvp static assets.
 * Serves files with HTTP Range support (required by PMTiles).
 * Run separately from the main API server: npm run dev:map
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const HOST = process.env.MAP_HOST || process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.MAP_PORT || process.env.PORT || 8080);
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
