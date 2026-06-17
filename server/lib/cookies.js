export const ACCESS_COOKIE =
  process.env.SESSION_COOKIE_NAME || "crmp_access_token";

export const REFRESH_COOKIE =
  process.env.REFRESH_COOKIE_NAME || "crmp_refresh_token";

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

export function setSessionCookies(res, session) {
  const accessTokenMaxAgeMs =
    Math.max(Number(session.expires_in || 3600) - 30, 60) * 1000;

  res.cookie(ACCESS_COOKIE, session.access_token, {
    ...baseCookieOptions(),
    maxAge: accessTokenMaxAgeMs
  });

  if (session.refresh_token) {
    res.cookie(REFRESH_COOKIE, session.refresh_token, {
      ...baseCookieOptions(),
      maxAge: REFRESH_TOKEN_MAX_AGE_MS
    });
  }
}

export function clearSessionCookies(res) {
  res.clearCookie(ACCESS_COOKIE, baseCookieOptions());
  res.clearCookie(REFRESH_COOKIE, baseCookieOptions());
}
