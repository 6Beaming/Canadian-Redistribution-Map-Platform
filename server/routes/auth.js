import { Router } from "express";
import {
  clearAuthenticatedSessionCookies,
  clearPendingSessionCookies,
  clearSessionCookies,
  setPendingSessionCookies,
  setSessionCookies
} from "../lib/cookies.js";
import {
  getSupabaseClient,
  startSupabasePhoneVerification,
  updateSupabaseUserMetadata,
  verifySupabasePhoneChange
} from "../lib/supabase.js";
import {
  requireAuth,
  requirePendingProfileAuth
} from "../middleware/requireAuth.js";

const router = Router();

const PENDING_PROFILE_METADATA_KEY = "pending_public_profile";

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
      e164: `+1${digits}`,
      national: digits
    };
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return {
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
      phoneNumber: phone.e164,
      phoneNational: phone.national,
      postalCode: `${postalCode.slice(0, 3)} ${postalCode.slice(3)}`,
      province
    }
  };
}

function isPublicProfileComplete(metadata = {}) {
  return Boolean(
    metadata.profile_complete &&
      metadata.first_name &&
      metadata.last_name &&
      metadata.province &&
      metadata.postal_code &&
      metadata.phone_number &&
      metadata.phone_verified_at
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
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    id: user.id,
    name: metadata.full_name || metadata.name || null,
    phoneNumber: metadata.phone_number || null,
    profileComplete:
      role === "public_user" ? isPublicProfileComplete(metadata) : true,
    role
  };
}

function pendingOtpState(user) {
  const pendingProfile =
    user.user_metadata?.[PENDING_PROFILE_METADATA_KEY] || null;

  if (!pendingProfile?.phone_number) {
    return null;
  }

  return {
    otpRequired: true,
    phoneMasked: maskPhoneNumber(pendingProfile.phone_number)
  };
}

function pendingProfileResponse(user) {
  const otpState = pendingOtpState(user);

  return {
    profileRequired: true,
    user: publicUser(user),
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

    const user = publicUser(data.user);

    if (!user.profileComplete) {
      clearAuthenticatedSessionCookies(res);
      setPendingSessionCookies(res, data.session);
      res.status(200).json(pendingProfileResponse(data.user));
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
        ...(emailRedirectTo ? { emailRedirectTo } : {}),
        data: {
          account_created_at: new Date().toISOString(),
          profile_complete: false,
          role: "public_user"
        }
      }
    });

    if (error) {
      res.status(400).json({ error: "Unable to create account." });
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

router.get("/profile-session", requirePendingProfileAuth, (req, res) => {
  const user = publicUser(req.user);

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

  res.json(pendingProfileResponse(req.user));
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
      phoneNational,
      phoneNumber,
      postalCode,
      province
    } = validation.profile;
    const metadata = req.user.user_metadata || {};
    const pendingProfile = {
      first_name: firstName,
      full_name: `${firstName} ${lastName}`,
      last_name: lastName,
      phone_national: phoneNational,
      phone_number: phoneNumber,
      postal_code: postalCode,
      province,
      saved_at: new Date().toISOString()
    };

    await updateSupabaseUserMetadata(req.accessToken, {
      ...metadata,
      [PENDING_PROFILE_METADATA_KEY]: pendingProfile,
      profile_complete: false,
      role: metadata.role || "public_user"
    });

    await startSupabasePhoneVerification(req.accessToken, phoneNumber);

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

    const metadata = req.user.user_metadata || {};
    const pendingProfile = metadata[PENDING_PROFILE_METADATA_KEY];

    if (!pendingProfile?.phone_number) {
      res.status(409).json({ error: "Save your profile before entering a code." });
      return;
    }

    try {
      await verifySupabasePhoneChange(
        req.accessToken,
        pendingProfile.phone_number,
        token
      );

      const {
        [PENDING_PROFILE_METADATA_KEY]: _pendingProfile,
        ...existingMetadata
      } = metadata;
      const updated = await updateSupabaseUserMetadata(req.accessToken, {
        ...existingMetadata,
        first_name: pendingProfile.first_name,
        full_name: pendingProfile.full_name,
        last_name: pendingProfile.last_name,
        phone_number: pendingProfile.phone_number,
        phone_verified_at: new Date().toISOString(),
        postal_code: pendingProfile.postal_code,
        profile_complete: true,
        profile_completed_at: new Date().toISOString(),
        province: pendingProfile.province,
        role: metadata.role || "public_user"
      });

      const user = publicUser(updated.user || updated);

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
  res.json({ user: publicUser(req.user) });
});

router.post("/logout", (_req, res) => {
  clearSessionCookies(res);
  res.status(204).send();
});

export default router;
