import { CookieOptions } from 'express';

/** HttpOnly session cookie name (read by auth middleware). */
export const SESSION_COOKIE_NAME = 'sessionToken';

/** Short-lived cookie holding OAuth `state` for CSRF protection on the callback. */
export const OAUTH_STATE_COOKIE_NAME = 'oauth_state';

/**
 * Parse JWT_EXPIRES_IN-style durations into milliseconds for cookie Max-Age.
 * Supports plain seconds, or values like 24h / 8h / 30m / 3600s. Default 8h.
 */
export function sessionMaxAgeMs(): number {
  const raw = (process.env.JWT_EXPIRES_IN || '8h').trim();
  const m = raw.match(/^(\d+)([smhd])?$/i);
  if (!m) return 8 * 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const unit = (m[2] || 's').toLowerCase();
  const mult =
    unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : unit === 'm' ? 60000 : 1000;
  return n * mult;
}

/**
 * Cookie options for the app session.
 * - Production (Cloud Run HTTPS, same-origin SPA+API): Secure + HttpOnly + SameSite=Lax
 * - Development: Secure=false so localhost over HTTP works
 */
export function sessionCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: sessionMaxAgeMs(),
  };
}

export function clearCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}

export function oauthStateCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60 * 1000, // 10 minutes for the OAuth round-trip
  };
}
