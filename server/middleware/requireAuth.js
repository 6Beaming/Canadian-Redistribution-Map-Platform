import {
  ACCESS_COOKIE,
  PENDING_ACCESS_COOKIE,
  PENDING_REFRESH_COOKIE,
  REFRESH_COOKIE,
  clearAuthenticatedSessionCookies,
  clearPendingSessionCookies,
  getCookie,
  setPendingSessionCookies,
  setSessionCookies
} from "../lib/cookies.js";
import { getSupabaseClient } from "../lib/supabase.js";

function hasCompletePublicProfile(user) {
  const metadata = user.user_metadata || {};
  const role =
    user.app_metadata?.role ||
    metadata.role ||
    user.app_metadata?.user_role ||
    "public_user";

  if (role !== "public_user") {
    return true;
  }

  return Boolean(
    metadata.first_name &&
      metadata.last_name &&
      metadata.province &&
      metadata.postal_code &&
      metadata.sin &&
      metadata.dob
  );
}

async function loadSession(req, res, options) {
  const accessToken = getCookie(req, options.accessCookieName);
  const refreshToken = getCookie(req, options.refreshCookieName);

  if (!accessToken && !refreshToken) {
    options.clearCookies(res);
    return null;
  }

  const supabase = getSupabaseClient();

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (!error && data?.user) {
      return { accessToken, refreshToken, user: data.user };
    }
  }

  if (refreshToken) {
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken
    });

    if (!error && data?.session?.access_token && data?.user) {
      options.setCookies(res, data.session);
      return {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: data.user
      };
    }
  }

  options.clearCookies(res);
  return null;
}

export async function requireAuth(req, res, next) {
  const session = await loadSession(req, res, {
    accessCookieName: ACCESS_COOKIE,
    clearCookies: clearAuthenticatedSessionCookies,
    refreshCookieName: REFRESH_COOKIE,
    setCookies: setSessionCookies
  });

  if (!session) {
    res.status(401).json({ error: "Authentication is required." });
    return;
  }

  if (!hasCompletePublicProfile(session.user)) {
    clearAuthenticatedSessionCookies(res);
    setPendingSessionCookies(res, {
      access_token: session.accessToken,
      expires_in: 3600,
      refresh_token: session.refreshToken
    });
    res.status(403).json({ error: "Profile completion is required." });
    return;
  }

  req.accessToken = session.accessToken;
  req.refreshToken = session.refreshToken;
  req.user = session.user;
  next();
}

export async function requirePendingProfileAuth(req, res, next) {
  const session = await loadSession(req, res, {
    accessCookieName: PENDING_ACCESS_COOKIE,
    clearCookies: clearPendingSessionCookies,
    refreshCookieName: PENDING_REFRESH_COOKIE,
    setCookies: setPendingSessionCookies
  });

  if (!session) {
    res.status(401).json({ error: "Authentication is required." });
    return;
  }

  req.accessToken = session.accessToken;
  req.refreshToken = session.refreshToken;
  req.user = session.user;
  next();
}
