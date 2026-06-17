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

router.post("/password-reset", async (req, res, next) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

  if (!email) {
    res.status(400).json({ error: "Email is required." });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const options = process.env.PASSWORD_RESET_REDIRECT_URL
      ? { redirectTo: process.env.PASSWORD_RESET_REDIRECT_URL }
      : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email, options);

    if (error) {
      res.status(400).json({ error: "Unable to send password reset link." });
      return;
    }

    res.status(200).json({
      message:
        "If an account exists for that email, a password reset link has been sent."
    });
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
