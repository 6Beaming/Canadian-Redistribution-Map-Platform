import { createClient } from "@supabase/supabase-js";

let supabaseClient;

const PROFILE_COLUMNS =
  "id,email,first_name,last_name,province,postal_code,phone,role,profile_completed,created_at";

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the environment."
    );
  }

  return { supabaseKey, supabaseUrl };
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

export async function upsertSupabaseProfile(accessToken, profile) {
  const supabase = getSupabaseUserClient(accessToken);
  const { data, error } = await supabase
    .from("profiles")
    .upsert(profile, { onConflict: "id" })
    .select(PROFILE_COLUMNS)
    .single();

  if (error) {
    const profileError = new Error(error.message || "Unable to save user profile.");
    profileError.statusCode = error.code === "42501" ? 403 : 500;
    profileError.publicMessage =
      error.code === "42501"
        ? "Profiles table permissions need to allow users to save their own profile."
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
