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
    throw new Error(error.message || "Unable to load user profile.");
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
    throw new Error(error.message || "Unable to save user profile.");
  }

  return data;
}

export async function startSupabasePhoneVerification(accessToken, phone) {
  const supabase = getSupabaseUserClient(accessToken);
  const { data, error } = await supabase.auth.updateUser({ phone });

  if (error) {
    throw new Error(error.message || "Unable to send phone verification code.");
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
    throw new Error(error.message || "Unable to verify phone code.");
  }

  return data;
}
