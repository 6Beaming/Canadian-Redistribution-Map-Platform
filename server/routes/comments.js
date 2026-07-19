import { Router } from "express";
import {
  getSupabaseClient,
  getSupabaseProfileEmailsAsAdmin,
} from "../lib/supabase.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

// LEGACY READ API: this proposal-scoped route still needs requireAuth and
// authorization policy before it can be treated as a production endpoint.
router.get("/proposal/:proposalId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { proposalId } = req.params;

  // Verify proposal exists and is in Yukon
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

// Get all comments for the Commissioner submissions table.
router.get("/", requireAuth, requireCommissioner, async (req, res) => {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("submissions")
    .select("*, dissemination_areas!submissions_dguid_fkey(community_name)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });


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
  const result = data.map(submission => ({
    ...submission,
    profile: profiles.find(
      profile => profile.id === submission.user_id
    ) || null
  }));

  res.json(result);
});

// LEGACY USER READ API: author identity must be derived from req.user and the
// requested user id must be authorized before this route is production-ready.
router.get("/:user_id", async (req, res) => {
  const supabase = getSupabaseClient();
  const { user_id } = req.params;

  const { data, error } = await supabase
    .from("submissions")
    .select("*, dissemination_areas!submissions_dguid_fkey(community_name)")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// LEGACY WRITE API: currently accepts body.user_id. Refactor to requireAuth,
// derive req.user.id server-side, and validate comment/objection geometry.
router.post("/", async (req, res) => {
  const supabase = getSupabaseClient();
  const { proposal_id, user_id, comment, fed_num, dguid, title, neighboring_dguid, type } = req.body;

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

  const { data, error } = await supabase
    .from("submissions")
    .insert([{
      proposal_id,
      user_id,
      comment,
      fed_num,
      dguid,
      neighboring_dguid,
      title: title || "Feedback",
      type,
      status: "pending"
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

// LEGACY DELETE API: add requireAuth and an author/commissioner authorization
// check before this endpoint is exposed outside the demonstration environment.
router.delete("/:commentId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { commentId } = req.params;

  const { error } = await supabase
    .from("submissions")
    .delete()
    .eq("id", commentId)
    .eq("type", "feedback");

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;

