import { Router } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// Get all tags for a comment
router.get("/:commentId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { commentId } = req.params;

  const { data, error } = await supabase
    .from("comment_tags")
    .select("*")
    .eq("comment_id", commentId)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Add a tag to a comment
router.post("/", async (req, res) => {
  const supabase = getSupabaseClient();
  const { comment_id, tag } = req.body;

  // Verify comment exists
  const { data: comment, error: commentError } = await supabase
    .from("comments")
    .select("id")
    .eq("id", comment_id)
    .single();

  if (commentError || !comment) {
    return res.status(404).json({ error: "Comment not found." });
  }

  const { data, error } = await supabase
    .from("comment_tags")
    .insert([{ comment_id, tag }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

// Remove a tag
router.delete("/:tagId", async (req, res) => {
  const supabase = getSupabaseClient();
  const { tagId } = req.params;

  const { error } = await supabase
    .from("comment_tags")
    .delete()
    .eq("id", tagId);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

export default router;