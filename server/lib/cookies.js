export const ACCESS_COOKIE =
  process.env.SESSION_COOKIE_NAME || "crmp_access_token";

export const REFRESH_COOKIE =
  process.env.REFRESH_COOKIE_NAME || "crmp_refresh_token";

export const PENDING_ACCESS_COOKIE =
  process.env.PENDING_SESSION_COOKIE_NAME || "crmp_pending_access_token";

export const PENDING_REFRESH_COOKIE =
  process.env.PENDING_REFRESH_COOKIE_NAME || "crmp_pending_refresh_token";

const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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

function clearCookiePair(res, accessCookieName, refreshCookieName) {
  res.clearCookie(accessCookieName, baseCookieOptions());
  res.clearCookie(refreshCookieName, baseCookieOptions());
}

export function clearAuthenticatedSessionCookies(res) {
  clearCookiePair(res, ACCESS_COOKIE, REFRESH_COOKIE);
}

export function clearPendingSessionCookies(res) {
  clearCookiePair(res, PENDING_ACCESS_COOKIE, PENDING_REFRESH_COOKIE);
}

export function clearSessionCookies(res) {
  clearAuthenticatedSessionCookies(res);
  clearPendingSessionCookies(res);
}
