import { Router } from "express";
import { clearSessionCookies, setSessionCookies } from "../lib/cookies.js";
import {
  getSupabaseClient,
  updateSupabaseUserMetadata
} from "../lib/supabase.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const VALID_PROVINCES = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT"
]);

function requiredString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePostalCode(value) {
  return requiredString(value).toUpperCase().replace(/\s+/g, "");
}

function normalizeSin(value) {
  return requiredString(value).replace(/\D/g, "");
}

function isValidDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) && date <= new Date();
}

function validatePublicProfile(body) {
  const firstName = requiredString(body?.firstName);
  const lastName = requiredString(body?.lastName);
  const province = requiredString(body?.province).toUpperCase();
  const postalCode = normalizePostalCode(body?.postalCode);
  const sin = normalizeSin(body?.sin);
  const dob = requiredString(body?.dob);

  if (!firstName || !lastName || !province || !postalCode || !sin || !dob) {
    return { error: "All profile fields are required." };
  }

  if (!VALID_PROVINCES.has(province)) {
    return { error: "Select a valid province or territory." };
  }

  if (
    !/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(
      postalCode
    )
  ) {
    return { error: "Enter a valid Canadian postal code." };
  }

  if (!/^\d{9}$/.test(sin)) {
    return { error: "SIN must contain 9 digits." };
  }

  if (!isValidDate(dob)) {
    return { error: "Enter a valid date of birth." };
  }

  return {
    profile: {
      dob,
      firstName,
      lastName,
      postalCode: `${postalCode.slice(0, 3)} ${postalCode.slice(3)}`,
      province,
      sin
    }
  };
}

function isPublicProfileComplete(metadata = {}) {
  return Boolean(
    metadata.first_name &&
      metadata.last_name &&
      metadata.province &&
      metadata.postal_code &&
      metadata.sin &&
      metadata.dob
  );
}

function publicUser(user) {
  const metadata = user.user_metadata || {};
  const role =
    user.app_metadata?.role ||
    metadata.role ||
    user.app_metadata?.user_role ||
    "public_user";

  return {
    id: user.id,
    email: user.email,
    name: metadata.full_name || metadata.name || null,
    profileComplete:
      role === "public_user" ? isPublicProfileComplete(metadata) : true,
    role
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

router.post("/signup", async (req, res, next) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required." });
    return;
  }

  if (password.length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters." });
    return;
  }

  try {
    const supabase = getSupabaseClient();
    const emailRedirectTo =
      process.env.SIGNUP_EMAIL_REDIRECT_URL || process.env.CLIENT_ORIGIN;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
        data: {
          account_created_at: new Date().toISOString(),
          profile_complete: false,
          role: "public_user",
        }
      }
    });

    if (error) {
      res.status(400).json({ error: "Unable to create account." });
      return;
    }

    res.status(201).json({
      message:
        "Account created. Check your email to validate your address before signing in."
    });
  } catch (error) {
    next(error);
  }
});

router.post("/profile", requireAuth, async (req, res, next) => {
  const validation = validatePublicProfile(req.body);

  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const { dob, firstName, lastName, postalCode, province, sin } =
      validation.profile;
    const updated = await updateSupabaseUserMetadata(req.accessToken, {
      ...(req.user.user_metadata || {}),
      dob,
      first_name: firstName,
      full_name: `${firstName} ${lastName}`,
      last_name: lastName,
      postal_code: postalCode,
      profile_complete: true,
      profile_completed_at: new Date().toISOString(),
      province,
      role: req.user.user_metadata?.role || "public_user",
      sin
    });

    res.status(200).json({ user: publicUser(updated.user || updated) });
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
