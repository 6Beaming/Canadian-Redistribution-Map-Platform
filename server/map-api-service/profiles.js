import fs from "fs";
import path from "path";
import { Router } from "express";
import { getMapDataRoot } from "./paths.js";

const router = Router();

router.get("/da-profiles", (_req, res, next) => {
  try {
    const filePath = path.join(getMapDataRoot(), "yt_da_profiles.json");
    const raw = fs.readFileSync(filePath, "utf8");
    res.type("application/json").send(raw);
  } catch (error) {
    next(error);
  }
});

export default router;
