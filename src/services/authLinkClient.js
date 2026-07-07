import { createClient } from "@supabase/supabase-js";

let authLinkClient;

export function getAuthLinkClient() {
  if (authLinkClient) {
    return authLinkClient;
  }

  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey =
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !publishableKey) {
    throw new Error("Email-link authentication is not configured.");
  }

  authLinkClient = createClient(url, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: true,
      persistSession: false
    }
  });

  return authLinkClient;
}
