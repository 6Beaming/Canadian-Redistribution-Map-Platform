import { createClient } from "@supabase/supabase-js";

let passwordRecoveryClient;

export function getPasswordRecoveryClient() {
  if (passwordRecoveryClient) {
    return passwordRecoveryClient;
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Password reset is not configured for this environment.");
  }

  passwordRecoveryClient = createClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: false
    }
  });

  return passwordRecoveryClient;
}
