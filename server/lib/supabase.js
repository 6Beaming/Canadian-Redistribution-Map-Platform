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
  const { error: insertError } = await supabase
    .from("pending_invites")
    .insert({
      email,
      invited_by: invitedBy
    });

  if (insertError) {
    const inviteError = new Error(
      insertError.message || "Unable to record commissioner invitation."
    );
    inviteError.statusCode = insertError.code === "23505" ? 409 : 400;
    inviteError.publicMessage =
      insertError.code === "23505"
        ? "An invitation is already pending for this email."
        : "Unable to record commissioner invitation.";
    throw inviteError;
  }

  const { data, error: emailError } =
    await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo
    });

  if (emailError) {
    const { error: cleanupError } = await supabase
      .from("pending_invites")
      .delete()
      .eq("email", email)
      .eq("invited_by", invitedBy);

    if (cleanupError) {
      console.error(
        `Unable to roll back pending invite for ${email}:`,
        cleanupError.message
      );
    }

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

  return data;
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

export async function createSupabaseCommissionerUser({
  email,
  emailRedirectTo,
  firstName,
  invitedBy = null,
  lastName,
  password,
  province
}) {
  const supabase = requireSupabaseAdminClient();
  const signupData = await signUpSupabaseUser({
    email,
    emailRedirectTo,
    password
  });
  const user = signupData.user || signupData;

  if (!user?.id) {
    const authError = new Error("Unable to create commissioner account.");
    authError.statusCode = 400;
    authError.publicMessage = authError.message;
    throw authError;
  }

  const profile = {
    email,
    first_name: firstName,
    id: user.id,
    invited_by: invitedBy,
    last_name: lastName,
    profile_completed: true,
    province,
    role: "commissioner"
  };

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select(PROFILE_COLUMNS)
    .single();

  if (profileError) {
    await supabase.auth.admin.deleteUser(user.id);

    const saveError = new Error(
      profileError.message || "Unable to save commissioner profile."
    );
    saveError.statusCode = profileError.code === "23505" ? 409 : 500;
    saveError.publicMessage =
      profileError.code === "23505"
        ? "A profile already exists for this account."
        : "Unable to save commissioner profile.";
    throw saveError;
  }

  return {
    profile: profileData,
    user
  };
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
