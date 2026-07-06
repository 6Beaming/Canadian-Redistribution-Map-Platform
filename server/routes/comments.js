import { Router } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// Get all comments for a Yukon proposal
router.get("/:proposalId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { proposalId } = req.params;

  // First verify this proposal is in Yukon
  const { data: proposal, error: proposalError } = await supabase
    .from("map_proposals")
    .select("id, province_code")
    .eq("id", proposalId)
    .eq("province_code", "YT")
    .single();

  if (proposalError || !proposal) {
    return res.status(404).json({ error: "Proposal not found or not in Yukon." });
  }

  const { data, error } = await supabase
    .from("comments")
    .select("*, profiles(first_name, last_name)")
    .eq("proposal_id", proposalId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Add a comment to a Yukon proposal
router.post("/", async (req, res) => {
  const supabase = getSupabaseClient();
  const { proposal_id, user_id, content } = req.body;

  // Verify Yukon
  const { data: proposal, error: proposalError } = await supabase
    .from("map_proposals")
    .select("id, province_code")
    .eq("id", proposal_id)
    .eq("province_code", "YT")
    .single();

  if (proposalError || !proposal) {
    return res.status(404).json({ error: "Proposal not found or not in Yukon." });
  }

  const { data, error } = await supabase
    .from("comments")
    .insert([{ proposal_id, user_id, content }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

// Delete a comment
router.delete("/:commentId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { commentId } = req.params;

  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", commentId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;