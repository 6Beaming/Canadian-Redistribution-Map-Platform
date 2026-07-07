import { createClient } from "@supabase/supabase-js";

let supabaseClient;
let supabaseAdminClient;

const PROFILE_COLUMNS =
  "id,email,first_name,last_name,province,postal_code,phone,role,profile_completed,invited_by,created_at";

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the environment."
    );
  }

  return { supabaseKey, supabaseServiceRoleKey, supabaseUrl };
}

export function getSupabaseClient() {
  if (supabaseClient) {
    return supabaseClient;
  }

  const { supabaseKey, supabaseUrl } = getSupabaseConfig();

  supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });

  return supabaseClient;
}

export async function signUpSupabaseUser({ email, emailRedirectTo, password }) {
  const { supabaseKey, supabaseUrl } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/auth/v1/signup`);

  if (emailRedirectTo) {
    url.searchParams.set("redirect_to", emailRedirectTo);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const signupError = new Error(
      data.msg ||
        data.error_description ||
        data.error ||
        "Unable to create account."
    );
    signupError.statusCode = response.status;
    signupError.publicMessage = signupError.message;
    throw signupError;
  }

  return data;
}

export async function resendSupabaseSignupConfirmation({ email, emailRedirectTo }) {
  const supabase = getSupabaseClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined
  });

  if (error) {
    const resendError = new Error(
      error.message || "Unable to resend verification email."
    );
    resendError.statusCode = error.status || 400;
    resendError.publicMessage = resendError.message;
    throw resendError;
  }
}

function getSupabaseUserClient(accessToken) {
  const { supabaseKey, supabaseUrl } = getSupabaseConfig();

  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    }
  });
}

function getSupabaseAdminClient() {
  if (supabaseAdminClient) {
    return supabaseAdminClient;
  }

  const { supabaseServiceRoleKey, supabaseUrl } = getSupabaseConfig();

  if (!supabaseServiceRoleKey) {
    return null;
  }

  supabaseAdminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });

  return supabaseAdminClient;
}

function requireSupabaseAdminClient() {
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    const configError = new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
    configError.statusCode = 500;
    configError.publicMessage =
      "Server is not configured to check existing accounts.";
    throw configError;
  }

  return supabase;
}

export function isSupabaseAdminConfigured() {
  return Boolean(getSupabaseAdminClient());
}

export async function findSupabaseAuthUserByEmail(email) {
  const supabase = requireSupabaseAdminClient();

  const normalizedEmail = email.toLowerCase();
  const perPage = 1000;
  let page = 1;

  while (page <= 20) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage
    });

    if (error) {
      const lookupError = new Error(
        error.message || "Unable to check existing users."
      );
      lookupError.statusCode = 500;
      lookupError.publicMessage = "Unable to check existing users.";
      throw lookupError;
    }

    const users = data?.users || [];
    const existingUser = users.find(
      (user) => user.email?.toLowerCase() === normalizedEmail
    );

    if (existingUser) {
      return existingUser;
    }

    if (users.length < perPage) {
      return null;
    }

    page += 1;
  }

  return null;
}

export async function findSupabaseProfileByPhone(phone) {
  const supabase = requireSupabaseAdminClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("phone", phone)
    .limit(1);

  if (error) {
    const lookupError = new Error(
      error.message || "Unable to check phone number."
    );
    lookupError.statusCode = 500;
    lookupError.publicMessage = "Unable to check phone number.";
    throw lookupError;
  }

  return data?.[0] || null;
}

export async function inviteSupabaseCommissioner({
  email,
  invitedBy,
  redirectTo
}) {
  const supabase = requireSupabaseAdminClient();
  const normalizedEmail = email.toLowerCase();
  const { data: existingPendingInvite, error: pendingLookupError } =
    await supabase
      .from("pending_invites")
      .select("email,invited_by")
      .eq("email", normalizedEmail)
      .maybeSingle();

  if (pendingLookupError) {
    const inviteError = new Error(
      pendingLookupError.message || "Unable to check pending invitation."
    );
    inviteError.statusCode = 500;
    inviteError.publicMessage = "Unable to check pending invitation.";
    throw inviteError;
  }

  const existingUser = await findSupabaseAuthUserByEmail(normalizedEmail);

  if (existingPendingInvite) {
    if (existingPendingInvite.invited_by !== invitedBy) {
      const inviteError = new Error(
        "This email already has an invitation from another commissioner."
      );
      inviteError.statusCode = 409;
      inviteError.publicMessage = inviteError.message;
      throw inviteError;
    }

    if (existingUser) {
      const existingProfile = await getSupabaseProfileAsAdmin(existingUser.id);

      if (existingProfile) {
        const inviteError = new Error(
          "This invitation has already been accepted. The colleague can sign in to continue."
        );
        inviteError.statusCode = 409;
        inviteError.publicMessage = inviteError.message;
        throw inviteError;
      }

      // A clicked invite can leave behind a confirmed auth user before the
      // password/profile flow finishes. The pending invite is still the source
      // of truth, so remove that stale auth row before resending.
      const { error: deleteError } =
        await supabase.auth.admin.deleteUser(existingUser.id);

      if (deleteError) {
        const inviteError = new Error(
          deleteError.message || "Unable to refresh expired invitation."
        );
        inviteError.statusCode = 500;
        inviteError.publicMessage = "Unable to refresh expired invitation.";
        throw inviteError;
      }
    }
  } else if (existingUser) {
    const inviteError = new Error("An account with this email already exists.");
    inviteError.statusCode = 409;
    inviteError.publicMessage = inviteError.message;
    throw inviteError;
  }

  let createdPendingInvite = false;

  if (!existingPendingInvite) {
    const { error: insertError } = await supabase
      .from("pending_invites")
      .insert({
        email: normalizedEmail,
        invited_by: invitedBy
      });

    if (insertError) {
      const inviteError = new Error(
        insertError.message || "Unable to record commissioner invitation."
      );
      inviteError.statusCode = insertError.code === "23505" ? 409 : 400;
      inviteError.publicMessage =
        insertError.code === "23505"
          ? "An invitation was created by another request. Please try again."
          : "Unable to record commissioner invitation.";
      throw inviteError;
    }

    createdPendingInvite = true;
  }

  const { data, error: emailError } =
    await supabase.auth.admin.inviteUserByEmail(normalizedEmail, {
      redirectTo
    });

  if (emailError && createdPendingInvite) {
    const { error: cleanupError } = await supabase
      .from("pending_invites")
      .delete()
      .eq("email", normalizedEmail)
      .eq("invited_by", invitedBy);

    if (cleanupError) {
      console.error(
        `Unable to roll back pending invite for ${normalizedEmail}:`,
        cleanupError.message
      );
    }
  }

  if (emailError) {
    const inviteError = new Error(
      emailError.message || "Unable to send commissioner invitation."
    );
    inviteError.statusCode = emailError.status || 400;
    inviteError.publicMessage =
      emailError.message?.toLowerCase().includes("already")
        ? "An account with this email already exists."
        : "Unable to send commissioner invitation.";
    throw inviteError;
  }

  return {
    data,
    resent: Boolean(existingPendingInvite)
  };
}

export async function getPendingCommissionerInvite(email) {
  const supabase = requireSupabaseAdminClient();
  const { data, error } = await supabase
    .from("pending_invites")
    .select("email,invited_by")
    .eq("email", email.toLowerCase())
    .maybeSingle();

  if (error) {
    const inviteError = new Error(
      error.message || "Unable to verify commissioner invitation."
    );
    inviteError.statusCode = 500;
    inviteError.publicMessage = "Unable to verify commissioner invitation.";
    throw inviteError;
  }

  return data;
}

export async function consumePendingCommissionerInvite(email, invitedBy) {
  const supabase = requireSupabaseAdminClient();
  const { error } = await supabase
    .from("pending_invites")
    .delete()
    .eq("email", email.toLowerCase())
    .eq("invited_by", invitedBy);

  if (error) {
    console.error(
      `Unable to consume pending invite for ${email}:`,
      error.message
    );
    return false;
  }

  return true;
}

export async function getSupabaseProfileAsAdmin(userId) {
  const supabase = requireSupabaseAdminClient();
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    const profileError = new Error(
      error.message || "Unable to load commissioner profile."
    );
    profileError.statusCode = 500;
    profileError.publicMessage = "Unable to verify commissioner team.";
    throw profileError;
  }

  return data;
}

export async function getSupabaseProfile(accessToken, userId) {
  const supabase = getSupabaseUserClient(accessToken);
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    const profileError = new Error(error.message || "Unable to load user profile.");
    profileError.statusCode = error.code === "42501" ? 403 : 500;
    throw profileError;
  }

  return data;
}

export async function updateSupabaseProfile(accessToken, userId, updates) {
  const supabase = getSupabaseUserClient(accessToken);
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    const profileError = new Error(
      error.message || "Unable to update user profile."
    );
    profileError.statusCode = error.code === "42501" ? 403 : 500;
    profileError.publicMessage =
      error.code === "42501"
        ? "Profiles table permissions need to allow users to update their own profile."
        : "Unable to update user profile.";
    throw profileError;
  }

  return data;
}

export async function upsertSupabaseProfile(accessToken, profile) {
  const supabase = getSupabaseUserClient(accessToken);
  const { data, error } = await supabase
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    const profileError = new Error(error.message || "Unable to save user profile.");
    profileError.statusCode =
      error.code === "42501" ? 403 : error.code === "23505" ? 409 : 500;
    profileError.publicMessage =
      error.code === "42501"
        ? "Profiles table permissions need to allow users to save their own profile."
        : error.code === "23505"
          ? "This phone number is already linked to another account."
        : "Unable to save user profile.";
    throw profileError;
  }

  return data;
}

export async function startSupabasePhoneVerification(accessToken, phone) {
  const { supabaseKey, supabaseUrl } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ phone })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const verificationError = new Error(
      data.msg ||
        data.error_description ||
        data.error ||
        "Unable to send phone verification code."
    );
    verificationError.statusCode = 400;
    verificationError.publicMessage = verificationError.message;
    throw verificationError;
  }

  return data;
}

export async function verifySupabasePhoneChange(accessToken, phone, token) {
  const supabase = getSupabaseUserClient(accessToken);
  const { data, error } = await supabase.auth.verifyOtp({
    phone,
    token,
    type: "phone_change"
  });

  if (error) {
    const verificationError = new Error(
      error.message || "Unable to verify phone code."
    );
    verificationError.statusCode = 400;
    verificationError.publicMessage = verificationError.message;
    throw verificationError;
  }

  return data;
}
