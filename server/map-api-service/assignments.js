import fs from "fs";
import path from "path";
import { Router } from "express";
import { getAssignmentsStorePath } from "./paths.js";

const router = Router();

function readAssignments() {
  const storePath = getAssignmentsStorePath();
  if (!fs.existsSync(storePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAssignments(assignments) {
  const storePath = getAssignmentsStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(assignments, null, 2), "utf8");
}

router.get("/assignments", (_req, res) => {
  res.json({ assignments: readAssignments() });
});

router.put("/assignments", (req, res) => {
  const incoming = req.body?.assignments;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    res.status(400).json({ error: "Body must include an assignments object." });
    return;
  }

  const sanitized = {};
  Object.entries(incoming).forEach(([dguid, districtId]) => {
    if (typeof dguid === "string" && dguid.trim()) {
      sanitized[dguid] = Number(districtId);
    }
  });

  writeAssignments(sanitized);
  res.json({ assignments: sanitized });
});

export default router;
