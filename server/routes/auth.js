import { Router } from "express";
import {
  clearAuthenticatedSessionCookies,
  clearPendingSessionCookies,
  clearSessionCookies,
  getPendingProfileCookie,
  setPendingProfileCookie,
  setPendingSessionCookies,
  setSessionCookies
} from "../lib/cookies.js";
import {
  getSupabaseProfile,
  getSupabaseClient,
  startSupabasePhoneVerification,
  upsertSupabaseProfile,
  verifySupabasePhoneChange
} from "../lib/supabase.js";
import {
  requireAuth,
  requirePendingProfileAuth
} from "../middleware/requireAuth.js";

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

function normalizePhoneNumber(value) {
  const digits = requiredString(value).replace(/\D/g, "");

  if (digits.length === 10) {
    return {
      auth: `1${digits}`,
      e164: `+1${digits}`,
      national: digits
    };
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return {
      auth: digits,
      e164: `+${digits}`,
      national: digits.slice(1)
    };
  }

  return null;
}

function maskPhoneNumber(value) {
  const digits = requiredString(value).replace(/\D/g, "");
  const lastFour = digits.slice(-4);

  return lastFour ? `***-***-${lastFour}` : "";
}

function validatePublicProfile(body) {
  const firstName = requiredString(body?.firstName);
  const lastName = requiredString(body?.lastName);
  const province = requiredString(body?.province).toUpperCase();
  const postalCode = normalizePostalCode(body?.postalCode);
  const phone = normalizePhoneNumber(body?.phoneNumber);

  if (!firstName || !lastName || !province || !postalCode || !phone) {
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

  return {
    profile: {
      firstName,
      lastName,
      phoneAuth: phone.auth,
      phoneNumber: phone.e164,
      phoneNational: phone.national,
      postalCode: `${postalCode.slice(0, 3)} ${postalCode.slice(3)}`,
      province
    }
  };
}

function isPublicProfileComplete(profile) {
  return Boolean(
    profile?.profile_completed &&
      profile.first_name &&
      profile.last_name &&
      profile.province &&
      profile.postal_code &&
      profile.phone
  );
}

function publicUser(user, profile = null) {
  const role = profile?.role || "public_user";
  const fullName = profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
    : "";

  return {
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    id: user.id,
    name: fullName || null,
    phoneNumber: profile?.phone || null,
    profileComplete:
      role === "public_user" ? isPublicProfileComplete(profile) : true,
    role
  };
}

function pendingOtpState(pendingProfile) {
  if (!pendingProfile?.phoneAuth) {
    return null;
  }

  return {
    otpRequired: true,
    phoneMasked: maskPhoneNumber(pendingProfile.phoneAuth)
  };
}

function pendingProfileResponse(user, profile = null, pendingProfile = null) {
  const otpState = pendingOtpState(pendingProfile);

  return {
    profileRequired: true,
    user: publicUser(user, profile),
    ...(otpState || {})
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
      const message = error?.message || "";

      if (message.toLowerCase().includes("email not confirmed")) {
        res.status(403).json({
          error: "Verify your email before signing in."
        });
        return;
      }

      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const profile = await getSupabaseProfile(data.session.access_token, data.user.id);
    const user = publicUser(data.user, profile);

    if (!user.profileComplete) {
      clearAuthenticatedSessionCookies(res);
      setPendingSessionCookies(res, data.session);
      res.status(200).json(pendingProfileResponse(data.user, profile));
      return;
    }

    clearPendingSessionCookies(res);
    setSessionCookies(res, data.session);
    res.status(200).json({ user });
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
        ...(emailRedirectTo ? { emailRedirectTo } : {})
      }
    });

    if (error) {
      console.error("Supabase signup failed:", error.message);
      res.status(400).json({
        error:
          process.env.NODE_ENV === "production"
            ? "Unable to create account."
            : error.message || "Unable to create account."
      });
      return;
    }

    res.status(201).json({
      message:
        "Account created. Check your email to verify your address before signing in."
    });
  } catch (error) {
    next(error);
  }
});

router.get("/profile-session", requirePendingProfileAuth, async (req, res, next) => {
  try {
    const profile = await getSupabaseProfile(req.accessToken, req.user.id);
    const pendingProfile = getPendingProfileCookie(req);
    const user = publicUser(req.user, profile);

    if (user.profileComplete) {
      clearPendingSessionCookies(res);
      setSessionCookies(res, {
        access_token: req.accessToken,
        expires_in: 3600,
        refresh_token: req.refreshToken
      });
      res.json({ user });
      return;
    }

    res.json(pendingProfileResponse(req.user, profile, pendingProfile));
  } catch (error) {
    next(error);
  }
});

router.post("/profile", requirePendingProfileAuth, async (req, res, next) => {
  const validation = validatePublicProfile(req.body);

  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const {
      firstName,
      lastName,
      phoneAuth,
      phoneNational,
      phoneNumber,
      postalCode,
      province
    } = validation.profile;
    await startSupabasePhoneVerification(req.accessToken, phoneAuth);
    setPendingProfileCookie(res, {
      firstName,
      lastName,
      phoneAuth,
      phoneNational,
      phoneNumber,
      postalCode,
      province
    });

    res.status(202).json({
      message: "Verification code sent.",
      otpRequired: true,
      phoneMasked: maskPhoneNumber(phoneNumber)
    });
  } catch (error) {
    next(error);
  }
});

router.post(
  "/profile/phone-otp",
  requirePendingProfileAuth,
  async (req, res, next) => {
    const token = requiredString(req.body?.token).replace(/\s+/g, "");

    if (!/^\d{6}$/.test(token)) {
      res.status(400).json({ error: "Enter the 6-digit verification code." });
      return;
    }

    const pendingProfile = getPendingProfileCookie(req);
    const phone = normalizePhoneNumber(pendingProfile?.phoneAuth);

    if (!pendingProfile || !phone) {
      res.status(409).json({ error: "Save your profile before entering a code." });
      return;
    }

    try {
      await verifySupabasePhoneChange(req.accessToken, phone.auth, token);

      const existingProfile = await getSupabaseProfile(req.accessToken, req.user.id);
      const completedProfile = await upsertSupabaseProfile(req.accessToken, {
        email: req.user.email,
        first_name: pendingProfile.firstName,
        id: req.user.id,
        last_name: pendingProfile.lastName,
        phone: pendingProfile.phoneNational,
        postal_code: pendingProfile.postalCode,
        profile_completed: true,
        province: pendingProfile.province,
        role: existingProfile?.role || "public_user"
      });

      const user = publicUser(req.user, completedProfile);

      clearPendingSessionCookies(res);
      setSessionCookies(res, {
        access_token: req.accessToken,
        expires_in: 3600,
        refresh_token: req.refreshToken
      });
      res.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  }
);

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
  res.json({ user: publicUser(req.user, req.profile) });
});

router.post("/logout", (_req, res) => {
  clearSessionCookies(res);
  res.status(204).send();
});

export default router;
