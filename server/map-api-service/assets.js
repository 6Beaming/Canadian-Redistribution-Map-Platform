import fs from "fs";
import path from "path";
import { Router } from "express";
import { ALLOWED_ASSET_FILES, getMapDataRoot } from "./paths.js";

const router = Router();

function resolveAssetPath(filename) {
  if (!ALLOWED_ASSET_FILES.has(filename)) {
    return null;
  }
  const filePath = path.join(getMapDataRoot(), filename);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return filePath;
}

function setAssetHeaders(res, filePath) {
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (filePath.endsWith(".geojson")) {
    res.setHeader("Content-Type", "application/geo+json");
  } else if (filePath.endsWith(".pmtiles")) {
    res.setHeader("Content-Type", "application/vnd.pmtiles");
  }
}

router.get("/assets/:filename", (req, res, next) => {
  const filePath = resolveAssetPath(req.params.filename);
  if (!filePath) {
    res.status(404).json({ error: "Map asset not found." });
    return;
  }

  setAssetHeaders(res, filePath);

  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  function pipeStream(stream) {
    stream.on("error", (error) => {
      if (!res.headersSent) {
        next(error);
        return;
      }
      res.destroy(error);
    });
    req.on("close", () => {
      if (!res.writableEnded) {
        stream.destroy();
      }
    });
    stream.pipe(res);
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
      return;
    }

    const start = match[1] === "" ? 0 : Number.parseInt(match[1], 10);
    const end = match[2] === "" ? stat.size - 1 : Number.parseInt(match[2], 10);

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= stat.size) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
      return;
    }

    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", String(chunkSize));
    pipeStream(fs.createReadStream(filePath, { start, end }));
    return;
  }

  res.setHeader("Content-Length", String(stat.size));
  pipeStream(fs.createReadStream(filePath));
});

export default router;
