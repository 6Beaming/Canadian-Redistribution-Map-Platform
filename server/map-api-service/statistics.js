import { Router } from "express";
import { statisticsStore } from "../lib/demographics/statisticsStore.js";

const router = Router();

router.get("/da/:dguid/statistics", async (req, res) => {
  try {
    const result = await statisticsStore.get(req.params.dguid);
    if (!result) return res.status(404).json({ error: "DA statistics were not found." });
    res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
    res.set("ETag", result.etag);
    if (req.get("If-None-Match") === result.etag) return res.status(304).end();
    return res.json(result.payload);
  } catch (error) {
    console.error("[statistics] local demographics index unavailable", error);
    return res.status(503).json({ error: "DA statistics are temporarily unavailable." });
  }
});

export default router;
