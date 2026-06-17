import { createClient } from "@supabase/supabase-js";

let passwordRecoveryClient;

export function getPasswordRecoveryClient() {
  if (passwordRecoveryClient) {
    return passwordRecoveryClient;
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error("Password reset is not configured for this environment.");
  }

  passwordRecoveryClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: false
    }
  });

  return passwordRecoveryClient;
}
