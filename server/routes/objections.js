import { Router } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// Get all objections for a proposal
router.get("/:proposalId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { proposalId } = req.params;

  const { data, error } = await supabase
    .from("submissions")
    .select("*")
    .eq("proposal_id", proposalId)
    .eq("type", "objection")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Submit a boundary objection
router.post("/", async (req, res) => {
  const supabase = getSupabaseClient();
  const { user_id, proposal_id, fed_num, dguid, title, comment, geometry } = req.body;

  if (!user_id || !title || !geometry) {
    return res.status(400).json({ error: "user_id, title, and geometry are required." });
  }

  const { data, error } = await supabase
    .from("submissions")
    .insert([{
      user_id,
      proposal_id,
      fed_num,
      dguid,
      title,
      comment,
      geometry,
      type: "objection",
      status: "pending"
    }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

// Delete an objection
router.delete("/:id", async (req, res) => {
  const supabase = getSupabaseClient();
  const { id } = req.params;

  const { error } = await supabase
    .from("submissions")
    .delete()
    .eq("id", id)
    .eq("type", "objection");

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;
