import { createClient } from "@supabase/supabase-js";

let supabaseClient;

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

export async function updateSupabaseUserMetadata(accessToken, metadata) {
  const { supabaseKey, supabaseUrl } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ data: metadata })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.msg || data.error_description || data.error || "Unable to update user profile.");
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
