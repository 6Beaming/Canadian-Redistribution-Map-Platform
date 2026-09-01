import crypto from "node:crypto";
import { Router } from "express";
import {
  loadCanonicalRelease,
  loadCurrentCanonicalRelease,
  readCanonicalDaPair,
  readExactDaFeature,
} from "../lib/map/canonicalReleaseStore.js";

const router = Router();

function etag(value) {
  return `"${crypto.createHash("sha256").update(value).digest("hex")}"`;
}

function sendImmutableJson(req, res, payload) {
  const body = JSON.stringify(payload);
  const tag = etag(body);
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("ETag", tag);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.headers["if-none-match"] === tag) {
    res.status(304).end();
    return;
  }
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  res.status(200).send(body);
}

router.get("/releases/current", (_req, res, next) => {
  try {
    const { manifest } = loadCurrentCanonicalRelease();
    res.setHeader("Cache-Control", "no-cache, must-revalidate");
    res.json({
      releaseId: manifest.releaseId,
      baseRevision: manifest.geometryRevision,
      manifestSha256: manifest.manifestSha256,
      topologyRevision: manifest.topologyRevision,
      normalizationVersion: manifest.normalizationVersion,
      vertexSchemaVersion: manifest.vertexSchemaVersion,
      lodSchemaVersion: manifest.lodSchemaVersion,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/releases/:releaseId/das/:dguid", async (req, res, next) => {
  try {
    if ((req.query.representation ?? "display") !== "display") {
      res.status(400).json({ error: "Single-DA routes only support display representation." });
      return;
    }
    const release = loadCanonicalRelease(req.params.releaseId);
    const { descriptor, feature } = await readExactDaFeature(release, req.params.dguid);
    sendImmutableJson(req, res, {
      releaseId: release.manifest.releaseId,
      baseRevision: release.manifest.geometryRevision,
      representation: "display",
      dguid: req.params.dguid,
      exactDigest: descriptor.sha256,
      feature,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/releases/:releaseId/da-pairs/:primaryDguid/:secondaryDguid", async (req, res, next) => {
  try {
    const representation = req.query.representation ?? "display";
    if (!new Set(["display", "edit"]).has(representation)) {
      res.status(400).json({ error: "representation must be display or edit." });
      return;
    }
    const release = loadCanonicalRelease(req.params.releaseId);
    const payload = await readCanonicalDaPair(
      release,
      req.params.primaryDguid,
      req.params.secondaryDguid,
      { representation, lod: req.query.lod ?? "auto" },
    );
    sendImmutableJson(req, res, payload);
  } catch (error) {
    next(error);
  }
});

export default router;
