export const ACCESS_COOKIE =
  process.env.SESSION_COOKIE_NAME || "crmp_access_token";

export const REFRESH_COOKIE =
  process.env.REFRESH_COOKIE_NAME || "crmp_refresh_token";

export const PENDING_ACCESS_COOKIE =
  process.env.PENDING_SESSION_COOKIE_NAME || "crmp_pending_access_token";

export const PENDING_REFRESH_COOKIE =
  process.env.PENDING_REFRESH_COOKIE_NAME || "crmp_pending_refresh_token";

export const PENDING_PROFILE_COOKIE =
  process.env.PENDING_PROFILE_COOKIE_NAME || "crmp_pending_profile";

export const PENDING_PROFILE_UPDATE_COOKIE =
  process.env.PENDING_PROFILE_UPDATE_COOKIE_NAME ||
  "crmp_pending_profile_update";

const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_PROFILE_MAX_AGE_MS = 10 * 60 * 1000;

function cookieSameSite() {
  const value = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
  return ["strict", "lax", "none"].includes(value) ? value : "lax";
}

function baseCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: cookieSameSite(),
    secure: process.env.NODE_ENV === "production"
  };
}

export function getCookie(req, name) {
  const header = req.headers.cookie;

  if (!header) {
    return null;
  }

  const cookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!cookie) {
    return null;
  }

  return decodeURIComponent(cookie.slice(name.length + 1));
}

export function getPendingProfileCookie(req) {
  const value = getCookie(req, PENDING_PROFILE_COOKIE);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function getPendingProfileUpdateCookie(req) {
  const value = getCookie(req, PENDING_PROFILE_UPDATE_COOKIE);

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function setCookiePair(res, session, accessCookieName, refreshCookieName) {
  const accessTokenMaxAgeMs =
    Math.max(Number(session.expires_in || 3600) - 30, 60) * 1000;

  res.cookie(accessCookieName, session.access_token, {
    ...baseCookieOptions(),
    maxAge: accessTokenMaxAgeMs
  });

  if (session.refresh_token) {
    res.cookie(refreshCookieName, session.refresh_token, {
      ...baseCookieOptions(),
      maxAge: REFRESH_TOKEN_MAX_AGE_MS
    });
  }
}

export function setSessionCookies(res, session) {
  setCookiePair(res, session, ACCESS_COOKIE, REFRESH_COOKIE);
}

export function setPendingSessionCookies(res, session) {
  setCookiePair(res, session, PENDING_ACCESS_COOKIE, PENDING_REFRESH_COOKIE);
}

export function setPendingProfileCookie(res, profile) {
  res.cookie(PENDING_PROFILE_COOKIE, JSON.stringify(profile), {
    ...baseCookieOptions(),
    maxAge: PENDING_PROFILE_MAX_AGE_MS
  });
}

export function setPendingProfileUpdateCookie(res, profile) {
  res.cookie(PENDING_PROFILE_UPDATE_COOKIE, JSON.stringify(profile), {
    ...baseCookieOptions(),
    maxAge: PENDING_PROFILE_MAX_AGE_MS
  });
}

function clearCookiePair(res, accessCookieName, refreshCookieName) {
  res.clearCookie(accessCookieName, baseCookieOptions());
  res.clearCookie(refreshCookieName, baseCookieOptions());
}

export function clearAuthenticatedSessionCookies(res) {
  clearCookiePair(res, ACCESS_COOKIE, REFRESH_COOKIE);
}

export function clearPendingSessionCookies(res) {
  clearCookiePair(res, PENDING_ACCESS_COOKIE, PENDING_REFRESH_COOKIE);
  res.clearCookie(PENDING_PROFILE_COOKIE, baseCookieOptions());
}

export function clearPendingProfileUpdateCookie(res) {
  res.clearCookie(PENDING_PROFILE_UPDATE_COOKIE, baseCookieOptions());
}

export function clearSessionCookies(res) {
  clearAuthenticatedSessionCookies(res);
  clearPendingSessionCookies(res);
  clearPendingProfileUpdateCookie(res);
}
