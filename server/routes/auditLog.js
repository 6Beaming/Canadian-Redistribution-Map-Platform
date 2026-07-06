import { Router } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

// Get all audit log entries, reverse chronological order
router.get("/", async (_req, res) => {
  const supabase = getSupabaseClient();

  const { data, error } = await supabase
    .from("audit_log")
    .select("*, profiles(first_name, last_name, email)")
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Create an audit log entry
router.post("/", async (req, res) => {
  const supabase = getSupabaseClient();
  const { user_id, action, target_id, details } = req.body;

  if (!user_id || !action) {
    return res.status(400).json({ error: "user_id and action are required." });
  }

  const { data, error } = await supabase
    .from("audit_log")
    .insert([{ user_id, action, target_id, details }])
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

export default router;