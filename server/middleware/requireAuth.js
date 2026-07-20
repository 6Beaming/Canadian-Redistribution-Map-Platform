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
import { getSupabaseClient, getSupabaseProfile } from "../lib/supabase.js";

function hasCompletePublicProfile(user, profile = null) {
  const storedRole = profile?.role || "public_user";
  const role = storedRole === "user" ? "public_user" : storedRole;

  if (role !== "public_user") {
    return true;
  }

  if (profile) {
    return Boolean(
      profile.first_name &&
        profile.last_name &&
        profile.province &&
        profile.postal_code &&
        profile.phone
    );
  }

  return false;
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
  try {
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

    const profile = await getSupabaseProfile(session.accessToken, session.user.id);

    if (!hasCompletePublicProfile(session.user, profile)) {
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
    req.profile = profile;
    req.user = session.user;
    next();
  } catch (error) {
    next(error);
  }
}

// This is the server counterpart to App.jsx's RequirePublicUser route guard.
// It is intentionally applied after requireAuth so role checks always use the
// verified profile rather than an untrusted client value.
export function requirePublicUser(req, res, next) {
  const role = req.profile?.role === "user" ? "public_user" : req.profile?.role;
  if (role !== "public_user") {
    res.status(403).json({ error: "This endpoint is available to public users only." });
    return;
  }

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
