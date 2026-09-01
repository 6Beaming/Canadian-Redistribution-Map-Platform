import { Router } from "express";
import {
  getSupabaseAdminDataClient,
  getSupabaseClient,
  getSupabaseProfileEmailsAsAdmin,
} from "../lib/supabase.js";
import { getProfileForDguid } from "../lib/map/mapAssetAuthority.js";
import { loadCurrentCanonicalRelease } from "../lib/map/canonicalReleaseStore.js";
import {
  buildZeroOperationGeometryDescriptor,
  persistSubmissionGeometryRevision,
} from "../lib/map/geometryOperations.js";
import { assertActiveMapRelease } from "../lib/map/mapReleaseGate.js";
import { enrichSubmissionsWithDaMetadata } from "../lib/map/submissionPresentation.js";
import { serializeLightweightSubmission } from "../lib/submissions/submissionListQuery.js";
import { requirePublicUser } from "../middleware/requireAuth.js";

const router = Router();

// Public-only proposal read. requireAuth is registered in server/app.js;
// this route adds the role boundary that prevents Commissioner fall-through.
router.get("/proposal/:proposalId", requirePublicUser, async (req, res) => {
  const supabase = getSupabaseClient();
  const { proposalId } = req.params;

  // Verify proposal exists
  const { data: proposal, error: proposalError } = await supabase
    .from("map_proposals")
    .select("id, province_code")
    .eq("id", proposalId)
    .single();

  if (proposalError || !proposal) {
    return res.status(404).json({ error: "Proposal not found." });
  }

  const { data, error } = await supabase
    .from("submissions")
    .select("*, profiles!submissions_user_id_fkey(first_name, last_name)")
    .eq("proposal_id", proposalId)
    .eq("type", "feedback")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});



function requireCommissioner(req, res, next) {
  if (req.profile?.role !== "commissioner") {
    res.status(403).json({ error: "Commissioner access is required." });
    return;
  }

  next();
}

// Get total number of sumissions
router.get("/count", async (req, res) => {
  const supabase = getSupabaseClient();

  const { count, error } = await supabase
    .from("submissions")
    .select("*", { count: "exact", head: true });

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ totalSubmissions: count });
});


// Get all submissions for the Commissioner submissions table.
router.get("/", requireCommissioner, async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const submissionId = String(req.query.submissionId ?? "").trim();

  let query = supabase
    .from("submissions")
    .select("id,user_id,type,fed_num,dguid,neighboring_dguid,title,status,comment,created_at,updated_at");
  if (submissionId) query = query.eq("id", submissionId);
  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  const enrichedSubmissions = await enrichSubmissionsWithDaMetadata(data ?? []);

  //AI generated code to merge and get profiles as well
  //Right now used as a stop gap since problem with schema
  // Get all unique user ids
  const userIds = [...new Set(data.map(s => s.user_id).filter(Boolean))];

  let profiles = [];

  try {
    profiles = await getSupabaseProfileEmailsAsAdmin(userIds);
  } catch (profileError) {
    return res.status(500).json({ error: profileError.message });
  }

  // Merge profiles into submissions
  const result = enrichedSubmissions.map((submission) => {
    const profile = profiles.find((entry) => entry.id === submission.user_id) || null;
    return {
      ...serializeLightweightSubmission(submission, profile),
      comment: submission.comment ?? "",
    };
  });

  res.json(result);
});

// Public-only self read. The URL id is checked against the verified session to
// prevent a signed-in user from enumerating another user's submissions.
router.get("/:user_id", requirePublicUser, async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { user_id } = req.params;

  if (user_id !== req.user.id) {
    return res.status(403).json({ error: "You can only view your own submissions." });
  }

  const { data, error } = await supabase
    .from("submissions")
    .select("*")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });

  try {
    const enrichedSubmissions = await enrichSubmissionsWithDaMetadata(data ?? []);
    return res.json(enrichedSubmissions);
  } catch (enrichmentError) {
    console.error("Unable to enrich submissions with map metadata:", enrichmentError);
    return res.json(
      (data ?? []).map((submission) => ({
        ...submission,
        dissemination_areas: {
          community_name: submission.dissemination_areas?.community_name ?? "Unknown",
        },
      })),
    );
  }
});

// Public-only submission write. The author is derived from the verified
// session; geometry-specific validation remains a dedicated follow-up API.
router.post("/", requirePublicUser, async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { proposal_id, comment, fed_num, dguid, title, neighboring_dguid, type } = req.body;
  const user_id = req.user.id;
  const normalizedType = String(type ?? "feedback").trim().toLowerCase();
  const primaryDguid = String(dguid ?? "").trim() || null;
  const secondaryDguid = String(neighboring_dguid ?? "").trim() || null;
  const normalizedTitle = String(title ?? "").trim();
  const normalizedComment = String(comment ?? "").trim();
  let currentRelease;
  let compactGeometry = null;

  if (!["feedback", "objection"].includes(normalizedType)) {
    return res.status(400).json({
      error: "Only feedback and objection submissions are supported on this route.",
    });
  }

  if (!normalizedTitle) {
    return res.status(400).json({ error: "Title is required." });
  }

  if (!normalizedComment) {
    return res.status(400).json({ error: "Comment is required." });
  }

  if (!primaryDguid) {
    return res.status(400).json({ error: "A dissemination area selection is required." });
  }

  try {
    await assertActiveMapRelease();
    currentRelease = loadCurrentCanonicalRelease();
    const primaryProfile = await getProfileForDguid(primaryDguid);
    if (!primaryProfile) {
      return res.status(400).json({ error: `Unknown or unavailable DA: ${primaryDguid}.` });
    }

    if (normalizedType === "objection") {
      if (!secondaryDguid) {
        return res.status(400).json({ error: "An objection requires a neighbouring DA." });
      }

      if (primaryDguid === secondaryDguid) {
        return res.status(400).json({ error: "An objection must target two distinct DAs." });
      }

      const secondaryProfile = await getProfileForDguid(secondaryDguid);
      if (!secondaryProfile) {
        return res.status(400).json({ error: `Unknown or unavailable DA: ${secondaryDguid}.` });
      }
      compactGeometry = buildZeroOperationGeometryDescriptor({ primaryDguid, secondaryDguid });
    }
  } catch (validationError) {
    return res.status(validationError.statusCode || 500).json({
      error: validationError.message || "Unable to validate the selected dissemination area.",
    });
  }

  // Verify proposal exists
  if (proposal_id) {
    const { data: proposal, error: proposalError } = await supabase
      .from("map_proposals")
      .select("id, province_code")
      .eq("id", proposal_id)
      .single();

    if (proposalError || !proposal) {
      return res.status(404).json({ error: "Proposal not found." });
    }
  }

  const resolvedFedNum =
    String(fed_num ?? "").trim()
    || (await getProfileForDguid(primaryDguid))?.fed_num
    || null;

  const { data, error } = await supabase
    .from("submissions")
    .insert([{
      proposal_id: proposal_id || null,
      user_id,
      comment: normalizedComment,
      fed_num: resolvedFedNum,
      dguid: primaryDguid,
      neighboring_dguid: normalizedType === "objection" ? secondaryDguid : null,
      title: normalizedTitle,
      type: normalizedType,
      status: "pending",
      release_id: currentRelease.manifest.releaseId,
    }])
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  if (normalizedType === "objection") {
    try {
      const geometryRevision = await persistSubmissionGeometryRevision(supabase, {
        submission: data,
        submissionType: "objection",
        compact: compactGeometry,
        validationReport: { operationCount: 0, immutableBase: true },
      });
      res.status(201).json({ ...data, geometry_revision: geometryRevision });
      return;
    } catch (geometryError) {
      await supabase.from("submissions").delete().eq("id", data.id);
      res.status(500).json({ error: geometryError.message });
      return;
    }
  }
  res.status(201).json(data);
});

// Public-only owned-submission delete. A Commissioner uses Workspace/Archive
// APIs instead and cannot mutate public submissions through this route.
router.delete("/:commentId", requirePublicUser, async (req, res) => {
  const supabase = getSupabaseAdminDataClient();
  const { commentId } = req.params;

  const { error } = await supabase
    .from("submissions")
    .delete()
    .eq("id", commentId)
    .eq("user_id", req.user.id)
    .eq("type", "feedback");

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;

