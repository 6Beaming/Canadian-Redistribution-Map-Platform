import { Router } from "express";
import { clearSessionCookies, setSessionCookies } from "../lib/cookies.js";
import { getSupabaseClient } from "../lib/supabase.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || user.user_metadata?.name || null,
    role:
      user.app_metadata?.role ||
      user.user_metadata?.role ||
      user.app_metadata?.user_role ||
      "user"
  };
}

router.post("/login", async (req, res, next) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data?.session || !data?.user) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    setSessionCookies(res, data.session);
    res.status(200).json({ user: publicUser(data.user) });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post("/logout", (_req, res) => {
  clearSessionCookies(res);
  res.status(204).send();
});

export default router;
