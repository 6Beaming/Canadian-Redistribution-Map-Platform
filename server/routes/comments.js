import { Router } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// Get all comments for Yukon boundary proposals
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



// Get all comments
router.get("/", async (req, res) => {
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

  if (userIds.length > 0) {
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);


    if (profileError) {
      return res.status(500).json({ error: profileError.message });
    }

    profiles = profileData;
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

// Get all comments for a userId
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

// Add comment to boundary proposal (only for Yukon proposals)
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

// Delete a comment/submission
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

