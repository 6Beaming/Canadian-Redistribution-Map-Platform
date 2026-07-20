import { Router } from "express";
import {
  getSupabaseClient,
  getSupabaseProfileEmailsAsAdmin,
} from "../lib/supabase.js";
import { requirePublicUser } from "../middleware/requireAuth.js";

const router = Router();

// Public-only proposal read. requireAuth is registered in server/app.js;
// this route adds the role boundary that prevents Commissioner fall-through.
router.get("/proposal/:proposalId", requirePublicUser, async (req, res) => {
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
router.get("/", requireCommissioner, async (req, res) => {
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

// Public-only self read. The URL id is checked against the verified session to
// prevent a signed-in user from enumerating another user's submissions.
router.get("/:user_id", requirePublicUser, async (req, res) => {
  const supabase = getSupabaseClient();
  const { user_id } = req.params;

  if (user_id !== req.user.id) {
    return res.status(403).json({ error: "You can only view your own submissions." });
  }

  const { data, error } = await supabase
    .from("submissions")
    .select("*, dissemination_areas!submissions_dguid_fkey(community_name)")
    .eq("user_id", user_id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Public-only submission write. The author is derived from the verified
// session; geometry-specific validation remains a dedicated follow-up API.
router.post("/", requirePublicUser, async (req, res) => {
  const supabase = getSupabaseClient();
  const { proposal_id, comment, fed_num, dguid, title, neighboring_dguid, type } = req.body;
  const user_id = req.user.id;

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

// Public-only owned-submission delete. A Commissioner uses Workspace/Archive
// APIs instead and cannot mutate public submissions through this route.
router.delete("/:commentId", requirePublicUser, async (req, res) => {
  const supabase = getSupabaseClient();
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

