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
  findSupabaseAuthUserByEmail,
  findSupabaseProfileByPhone,
  createSupabaseCommissionerUser,
  getSupabaseProfile,
  getSupabaseClient,
  resendSupabaseSignupConfirmation,
  signUpSupabaseUser,
  startSupabasePhoneVerification,
  updateSupabaseProfile,
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

function validateCommissionerSignup(body) {
  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const firstName = requiredString(body?.firstName);
  const lastName = requiredString(body?.lastName);
  const province = requiredString(body?.province).toUpperCase();

  if (!email || !password || !firstName || !lastName || !province) {
    return { error: "All commissioner signup fields are required." };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  if (!VALID_PROVINCES.has(province)) {
    return { error: "Select a valid province or territory." };
  }

  return {
    account: {
      email,
      firstName,
      lastName,
      password,
      province
    }
  };
}

function validateCommissionerProfile(body) {
  const firstName = requiredString(body?.firstName);
  const lastName = requiredString(body?.lastName);

  if (!firstName || !lastName) {
    return { error: "First name and last name are required." };
  }

  return {
    profile: {
      firstName,
      lastName
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
    firstName: profile?.first_name || null,
    id: user.id,
    lastName: profile?.last_name || null,
    name: fullName || null,
    phoneNumber: profile?.phone || null,
    profileComplete:
      role === "public_user" ? isPublicProfileComplete(profile) : true,
    province: profile?.province || null,
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

function signupErrorMessage(message = "") {
  const normalizedMessage = message.toLowerCase();

  if (
    normalizedMessage.includes("already") ||
    normalizedMessage.includes("registered") ||
    normalizedMessage.includes("exists")
  ) {
    return "An account with this email already exists. Please sign in.";
  }

  if (normalizedMessage.includes("rate limit")) {
    return "Email rate limit exceeded. Please wait before trying again.";
  }

  if (normalizedMessage.includes("confirm") || normalizedMessage.includes("email")) {
    return message;
  }

  return "Unable to create account.";
}

function isEmailVerified(user) {
  return Boolean(user?.email_confirmed_at || user?.confirmed_at);
}

function getSignupEmailRedirectUrl() {
  const configuredRedirect = requiredString(process.env.SIGNUP_EMAIL_REDIRECT_URL);

  if (configuredRedirect) {
    const redirectUrl = new URL(configuredRedirect);

    if (
      redirectUrl.pathname === "/" ||
      redirectUrl.pathname === "" ||
      redirectUrl.pathname === "/auth/callback"
    ) {
      redirectUrl.pathname = "/sign-in";
    }

    return redirectUrl.toString();
  }

  const clientOrigin = requiredString(process.env.CLIENT_ORIGIN);

  if (!clientOrigin) {
    return undefined;
  }

  return new URL("/sign-in", clientOrigin).toString();
}

async function applySessionCookiesForUser(res, session, user) {
  const profile = await getSupabaseProfile(session.access_token, user.id);
  const publicUserData = publicUser(user, profile);

  if (!publicUserData.profileComplete) {
    clearAuthenticatedSessionCookies(res);
    setPendingSessionCookies(res, session);
    return pendingProfileResponse(user, profile);
  }

  clearPendingSessionCookies(res);
  setSessionCookies(res, session);
  return { user: publicUserData };
}

async function phoneBelongsToAnotherUser(phoneNational, userId) {
  const existingProfile = await findSupabaseProfileByPhone(phoneNational);

  return Boolean(existingProfile && existingProfile.id !== userId);
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

    const responseBody = await applySessionCookiesForUser(
      res,
      data.session,
      data.user
    );
    res.status(200).json(responseBody);
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
    const existingUser = await findSupabaseAuthUserByEmail(email);
    const emailRedirectTo = getSignupEmailRedirectUrl();

    if (existingUser) {
      if (!isEmailVerified(existingUser)) {
        await resendSupabaseSignupConfirmation({
          email,
          emailRedirectTo
        });

        res.status(200).json({
          message:
            "A verification email was already pending. We sent a new verification link to your email."
        });
        return;
      }

      res.status(409).json({
        error: "An account with this email already exists. Please sign in."
      });
      return;
    }

    await signUpSupabaseUser({
      email,
      password,
      emailRedirectTo
    });

    res.status(201).json({
      message:
        "Account created. Check your email to verify your address before signing in."
    });
  } catch (error) {
    if (error.publicMessage) {
      console.error("Supabase signup failed:", error.publicMessage);
      res.status(error.statusCode || 400).json({
        error: signupErrorMessage(error.publicMessage)
      });
      return;
    }

    next(error);
  }
});

router.post("/commissioner-signup", async (req, res, next) => {
  const validation = validateCommissionerSignup(req.body);

  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const existingUser = await findSupabaseAuthUserByEmail(
      validation.account.email
    );
    const emailRedirectTo = getSignupEmailRedirectUrl();

    if (existingUser) {
      if (!isEmailVerified(existingUser)) {
        await resendSupabaseSignupConfirmation({
          email: validation.account.email,
          emailRedirectTo
        });

        res.status(200).json({
          message:
            "A commissioner verification email was already pending. We sent a new verification link to your email."
        });
        return;
      }

      res.status(409).json({
        error: "An account with this email already exists. Please sign in."
      });
      return;
    }

    await createSupabaseCommissionerUser({
      ...validation.account,
      emailRedirectTo
    });

    res.status(201).json({
      message:
        "Commissioner account created. Check your email to verify your address before signing in."
    });
  } catch (error) {
    if (error.publicMessage) {
      res.status(error.statusCode || 400).json({ error: error.publicMessage });
      return;
    }

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

    if (await phoneBelongsToAnotherUser(phoneNational, req.user.id)) {
      res.status(409).json({
        error: "This phone number is already linked to another account."
      });
      return;
    }

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
      if (await phoneBelongsToAnotherUser(pendingProfile.phoneNational, req.user.id)) {
        res.status(409).json({
          error: "This phone number is already linked to another account."
        });
        return;
      }

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

router.patch("/me", requireAuth, async (req, res, next) => {
  if (req.profile?.role !== "commissioner") {
    res.status(403).json({
      error: "Only commissioners can update a commissioner profile."
    });
    return;
  }

  const validation = validateCommissionerProfile(req.body);

  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  try {
    const updatedProfile = await updateSupabaseProfile(
      req.accessToken,
      req.user.id,
      {
        first_name: validation.profile.firstName,
        last_name: validation.profile.lastName
      }
    );

    res.json({
      message: "Profile information updated.",
      user: publicUser(req.user, updatedProfile)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", (_req, res) => {
  clearSessionCookies(res);
  res.status(204).send();
});

export default router;
