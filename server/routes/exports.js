import { Router } from "express";
import { getSupabaseAdminDataClient } from "../lib/supabase.js";
import { streamArchiveTreeExport } from "../lib/archive/archiveExportSerializer.js";
import { CSV_BOM, formatCsvHeader } from "../lib/export/csvWriter.js";
import {
  CSV_COLUMNS,
  streamCommissionerSubmissionCsv,
} from "../lib/export/commissionerSubmissionCsv.js";

const router = Router();

function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    return res.status(403).json({ error: "Commissioner access is required." });
  }
  return next();
}

router.use(requireCommissioner);

router.get("/archive-tree.json", async (req, res) => {
  try {
    const supabase = getSupabaseAdminDataClient();
    await streamArchiveTreeExport(res, supabase);
    return res.end();
  } catch (error) {
    if (res.headersSent) return res.end();
    return res.status(error.statusCode || 500).json({
      error: error.message || "Unable to export archived tree.",
    });
  }
});

async function sendSubmissionCsv(req, res) {
  try {
    const supabase = getSupabaseAdminDataClient();
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=commissioner-submissions.csv",
      "Cache-Control": "no-store",
    });
    res.write(CSV_BOM);
    res.write(formatCsvHeader(CSV_COLUMNS));
    await streamCommissionerSubmissionCsv(res, supabase, {
      actorProfile: req.profile,
      body: req.body ?? {},
      serverTiming: req.serverTiming,
    });
    return res.end();
  } catch (error) {
    if (!res.headersSent) {
      return res.status(error.statusCode || 500).json({
        error: error.message || "Unable to export submissions.",
      });
    }
    return res.end();
  }
}

router.get("/submissions.csv", sendSubmissionCsv);
router.post("/submissions.csv", sendSubmissionCsv);

export default router;
