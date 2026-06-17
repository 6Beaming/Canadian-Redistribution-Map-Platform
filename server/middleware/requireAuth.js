import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  getCookie,
  setSessionCookies
} from "../lib/cookies.js";
import { getSupabaseClient } from "../lib/supabase.js";

export async function requireAuth(req, res, next) {
  const accessToken = getCookie(req, ACCESS_COOKIE);
  const refreshToken = getCookie(req, REFRESH_COOKIE);

  if (!accessToken && !refreshToken) {
    clearSessionCookies(res);
    res.status(401).json({ error: "Authentication is required." });
    return;
  }

  const supabase = getSupabaseClient();

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (!error && data?.user) {
      req.accessToken = accessToken;
      req.user = data.user;
      next();
      return;
    }
  }

  if (refreshToken) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (!error && data?.session?.access_token && data?.user) {
      setSessionCookies(res, data.session);
      req.accessToken = data.session.access_token;
      req.user = data.user;
      next();
      return;
    }
  }

  clearSessionCookies(res);
  res.status(401).json({ error: "Authentication is required." });
}
