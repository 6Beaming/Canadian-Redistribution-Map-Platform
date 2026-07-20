import { Router } from "express";
import {
  clearAuthenticatedSessionCookies,
  clearPendingProfileUpdateCookie,
  clearPendingSessionCookies,
  clearSessionCookies,
  getPendingProfileCookie,
  getPendingProfileUpdateCookie,
  setPendingProfileCookie,
  setPendingProfileUpdateCookie,
  setPendingSessionCookies,
  setSessionCookies
} from "../lib/cookies.js";
import {
  consumePendingCommissionerInvite,
  findSupabaseAuthUserByEmail,
  findSupabaseProfileByPhone,
  getPendingCommissionerInvite,
  getSupabaseProfileAsAdmin,
  getSupabaseProfile,
  getSupabaseClient,
  inviteSupabaseCommissioner,
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
import {
  geocodeCanadianPostalCode,
  getPostalMapCenter,
  isGoogleGeocodingConfigured,
  shouldRefreshPostalGeocode
} from "../lib/googleGeocoding.js";

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

function validateCommissionerProfile(body) {
  const firstName = requiredString(body?.firstName);
  const lastName = requiredString(body?.lastName);
  const province = requiredString(body?.province).toUpperCase();

  if (!firstName || !lastName || !province) {
    return { error: "First name, last name, and province are required." };
  }

  if (!VALID_PROVINCES.has(province)) {
    return { error: "Select a valid province or territory." };
  }

  return {
    profile: {
      firstName,
      lastName,
      province
    }
  };
}

function validateCommissionerInvite(body) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).length !== 1 ||
    !Object.hasOwn(body, "email")
  ) {
    return { error: "Only an email address may be submitted." };
  }

  const email = requiredString(body.email).toLowerCase();

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { error: "Enter a valid email address." };
  }

  return { email };
}

function isPublicProfileComplete(profile) {
  return Boolean(
    profile?.first_name &&
      profile.last_name &&
      profile.province &&
      profile.postal_code &&
      profile.phone
  );
}

async function postalGeocodeUpdates(profile) {
  if (!isGoogleGeocodingConfigured()) {
    return {};
  }

  try {
    const result = await geocodeCanadianPostalCode({
      postalCode: profile.postalCode,
      province: profile.province
    });

    return {
      postal_geocoded_at: new Date().toISOString(),
      postal_latitude: result?.latitude ?? null,
      postal_longitude: result?.longitude ?? null
    };
  } catch (error) {
    console.warn("Unable to geocode a profile postal code:", error.message);
    return {};
  }
}

function publicUser(user, profile = null) {
  const storedRole = profile?.role || "public_user";
  const role = storedRole === "user" ? "public_user" : storedRole;
  const fullName = profile
    ? `${profile.first_name || ""} ${profile.last_name || ""}`.trim()
    : "";
  const mapCenter = getPostalMapCenter(profile);

  return {
    email: user.email,
    emailVerified: Boolean(user.email_confirmed_at || user.confirmed_at),
    firstName: profile?.first_name || null,
    id: user.id,
    lastName: profile?.last_name || null,
    mapCenter,
    name: fullName || null,
    phoneNumber: profile?.phone || null,
    postalCode: profile?.postal_code || null,
    profileComplete:
      role === "public_user" ? isPublicProfileComplete(profile) : true,
    province: profile?.province || null,
    role
  };
}

function publicProfileUpdates(user, profile) {
  return {
    email: user.email,
    first_name: profile.firstName,
    last_name: profile.lastName,
    phone: profile.phoneNational,
    postal_code: profile.postalCode,
    province: profile.province,
    role: "public_user"
  };
}

function publicProfileInformationUpdates(user, profile) {
  return {
    email: user.email,
    first_name: profile.firstName,
    last_name: profile.lastName,
    postal_code: profile.postalCode,
    province: profile.province,
    role: "public_user"
  };
}

async function profileWithPostalMapCenter(accessToken, userId, profile) {
  const profileRole = profile?.role || "public_user";

  if (
    !["public_user", "user"].includes(profileRole) ||
    !shouldRefreshPostalGeocode(profile)
  ) {
    return profile;
  }

  const geocodeUpdates = await postalGeocodeUpdates({
    postalCode: profile.postal_code,
    province: profile.province
  });

  if (!Object.keys(geocodeUpdates).length) {
    return profile;
  }

  try {
    return await updateSupabaseProfile(accessToken, userId, geocodeUpdates);
  } catch (error) {
    // Map centering is optional and must not prevent session restoration.
    console.warn("Unable to save a profile map center:", error.message);
    return profile;
  }
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

function pendingProfileResponse(
  user,
  profile = null,
  pendingProfile = null,
  pendingInvite = null
) {
  const otpState = pendingInvite ? null : pendingOtpState(pendingProfile);
  const pendingUser = publicUser(user, profile);

  if (pendingInvite) {
    pendingUser.role = "commissioner";
    pendingUser.profileComplete = false;
  }

  return {
    profileRequired: true,
    user: pendingUser,
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

function getCommissionerInviteRedirectUrl() {
  const configuredRedirect = requiredString(
    process.env.COMMISSIONER_INVITE_REDIRECT_URL
  );

  if (configuredRedirect) {
    return new URL(configuredRedirect).toString();
  }

  const clientOrigin = requiredString(process.env.CLIENT_ORIGIN);

  return clientOrigin
    ? new URL("/accept-invite", clientOrigin).toString()
    : undefined;
}

async function applySessionCookiesForUser(res, session, user) {
  const storedProfile = await getSupabaseProfile(session.access_token, user.id);
  const profile = await profileWithPostalMapCenter(
    session.access_token,
    user.id,
    storedProfile
  );
  const publicUserData = publicUser(user, profile);

  if (!publicUserData.profileComplete) {
    const pendingInvite = await getPendingCommissionerInvite(user.email);

    clearAuthenticatedSessionCookies(res);
    setPendingSessionCookies(res, session);
    return pendingProfileResponse(user, profile, null, pendingInvite);
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

router.post("/commissioner-invites", requireAuth, async (req, res, next) => {
  if (req.profile?.role !== "commissioner") {
    res.status(403).json({
      error: "Only commissioners can invite a new commissioner."
    });
    return;
  }

  const validation = validateCommissionerInvite(req.body);

  if (validation.error) {
    res.status(400).json({ error: validation.error });
    return;
  }

  if (validation.email === requiredString(req.user.email).toLowerCase()) {
    res.status(400).json({ error: "You cannot invite your own email." });
    return;
  }

  try {
    const invitation = await inviteSupabaseCommissioner({
      email: validation.email,
      invitedBy: req.user.id,
      redirectTo: getCommissionerInviteRedirectUrl()
    });

    res.status(201).json({
      message: `Invitation ${invitation.resent ? "resent" : "sent"} to ${validation.email}.`
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

    const pendingInvite = await getPendingCommissionerInvite(req.user.email);

    res.json(
      pendingProfileResponse(req.user, profile, pendingProfile, pendingInvite)
    );
  } catch (error) {
    next(error);
  }
});

router.post("/profile", requirePendingProfileAuth, async (req, res, next) => {
  try {
    const pendingInvite = await getPendingCommissionerInvite(req.user.email);

    if (pendingInvite) {
      const validation = validateCommissionerProfile(req.body);

      if (validation.error) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const inviterProfile = await getSupabaseProfileAsAdmin(
        pendingInvite.invited_by
      );

      if (!inviterProfile || inviterProfile.role !== "commissioner") {
        res.status(403).json({
          error: "The commissioner invitation is no longer valid."
        });
        return;
      }

      const completedProfile = await upsertSupabaseProfile(req.accessToken, {
        email: req.user.email,
        first_name: validation.profile.firstName,
        id: req.user.id,
        invited_by: pendingInvite.invited_by,
        last_name: validation.profile.lastName,
        province: validation.profile.province,
        role: "commissioner"
      });

      await consumePendingCommissionerInvite(
        req.user.email,
        pendingInvite.invited_by
      );

      const user = publicUser(req.user, completedProfile);

      clearPendingSessionCookies(res);
      setSessionCookies(res, {
        access_token: req.accessToken,
        expires_in: 3600,
        refresh_token: req.refreshToken
      });
      res.status(200).json({
        message: "Commissioner profile completed.",
        user
      });
      return;
    }

    const validation = validatePublicProfile(req.body);

    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

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
      const pendingInvite = await getPendingCommissionerInvite(req.user.email);
      const invitedAsCommissioner = pendingProfile.invitedAsCommissioner === true;
      const inviterProfile = pendingInvite
        ? await getSupabaseProfileAsAdmin(pendingInvite.invited_by)
        : null;

      if (invitedAsCommissioner && !pendingInvite) {
        res.status(403).json({
          error: "The commissioner invitation is no longer valid."
        });
        return;
      }

      if (
        pendingInvite &&
        (!inviterProfile || inviterProfile.role !== "commissioner")
      ) {
        res.status(403).json({
          error: "The commissioner invitation is no longer valid."
        });
        return;
      }

      const geocodeUpdates = pendingInvite
        ? {}
        : await postalGeocodeUpdates(pendingProfile);
      const completedProfile = await upsertSupabaseProfile(req.accessToken, {
        email: req.user.email,
        first_name: pendingProfile.firstName,
        id: req.user.id,
        invited_by: pendingInvite?.invited_by || null,
        last_name: pendingProfile.lastName,
        phone: pendingProfile.phoneNational,
        postal_code: pendingProfile.postalCode,
        province: inviterProfile?.province || pendingProfile.province,
        role: pendingInvite
          ? "commissioner"
          : existingProfile?.role || "public_user",
        ...geocodeUpdates
      });

      if (pendingInvite) {
        await consumePendingCommissionerInvite(
          req.user.email,
          pendingInvite.invited_by
        );
      }

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

router.get("/me", requireAuth, async (req, res) => {
  const profile = await profileWithPostalMapCenter(
    req.accessToken,
    req.user.id,
    req.profile
  );

  res.json({ user: publicUser(req.user, profile) });
});

router.patch("/me", requireAuth, async (req, res, next) => {
  try {
    const profileRole = req.profile?.role || "public_user";

    if (profileRole === "commissioner") {
      const validation = validateCommissionerProfile(req.body);

      if (validation.error) {
        res.status(400).json({ error: validation.error });
        return;
      }

      const updatedProfile = await updateSupabaseProfile(
        req.accessToken,
        req.user.id,
        {
          first_name: validation.profile.firstName,
          last_name: validation.profile.lastName,
          province: validation.profile.province
        }
      );

      res.json({
        message: "Profile information updated.",
        user: publicUser(req.user, updatedProfile)
      });
      return;
    }

    if (!["public_user", "user"].includes(profileRole)) {
      res.status(403).json({
        error: "Only public users can update a public profile."
      });
      return;
    }

    const validation = validatePublicProfile(req.body);

    if (validation.error) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const { phoneNational, phoneNumber } = validation.profile;

    if (await phoneBelongsToAnotherUser(phoneNational, req.user.id)) {
      res.status(409).json({
        error: "This phone number is already linked to another account."
      });
      return;
    }

    const phoneChanged = requiredString(req.profile?.phone) !== phoneNational;
    const geocodeUpdates = shouldRefreshPostalGeocode(req.profile, {
      postalCode: validation.profile.postalCode,
      province: validation.profile.province
    })
      ? await postalGeocodeUpdates(validation.profile)
      : {};

    if (phoneChanged) {
      const updatedProfile = await updateSupabaseProfile(
        req.accessToken,
        req.user.id,
        {
          ...publicProfileInformationUpdates(req.user, validation.profile),
          ...geocodeUpdates
        }
      );

      await startSupabasePhoneVerification(
        req.accessToken,
        validation.profile.phoneAuth
      );
      setPendingProfileUpdateCookie(res, validation.profile);

      res.status(202).json({
        message: "Profile information saved. Verification code sent.",
        otpRequired: true,
        phoneMasked: maskPhoneNumber(phoneNumber),
        user: publicUser(req.user, updatedProfile)
      });
      return;
    }

    const updatedProfile = await updateSupabaseProfile(
      req.accessToken,
      req.user.id,
      {
        ...publicProfileUpdates(req.user, validation.profile),
        ...geocodeUpdates
      }
    );

    clearPendingProfileUpdateCookie(res);
    res.json({
      message: "Profile information updated.",
      user: publicUser(req.user, updatedProfile)
    });
  } catch (error) {
    next(error);
  }
});

router.post("/me/phone-otp", requireAuth, async (req, res, next) => {
  const profileRole = req.profile?.role || "public_user";

  if (!["public_user", "user"].includes(profileRole)) {
    res.status(403).json({
      error: "Only public users can verify a public profile phone change."
    });
    return;
  }

  const token = requiredString(req.body?.token).replace(/\s+/g, "");

  if (!/^\d{6}$/.test(token)) {
    res.status(400).json({ error: "Enter the 6-digit verification code." });
    return;
  }

  const pendingProfile = getPendingProfileUpdateCookie(req);
  const validation = validatePublicProfile(pendingProfile);

  if (!pendingProfile || validation.error) {
    res.status(409).json({ error: "Save your profile before entering a code." });
    return;
  }

  try {
    if (
      await phoneBelongsToAnotherUser(
        validation.profile.phoneNational,
        req.user.id
      )
    ) {
      res.status(409).json({
        error: "This phone number is already linked to another account."
      });
      return;
    }

    await verifySupabasePhoneChange(
      req.accessToken,
      validation.profile.phoneAuth,
      token
    );

    const updatedProfile = await updateSupabaseProfile(
      req.accessToken,
      req.user.id,
      publicProfileUpdates(req.user, validation.profile)
    );

    clearPendingProfileUpdateCookie(res);
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
