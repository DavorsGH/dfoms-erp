/** Global auth session persistence (stay logged in) — platform-wide, no tenant logic. */

/** Browser cookie maxAge when Supabase session time-box is disabled (unlimited). */
export const AUTH_COOKIE_PERSIST_DEFAULT_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export const AUTH_PERSIST_FLAG_COOKIE = "dfoms-auth-persist";

export const AUTH_PERSIST_ENABLED_VALUE = "1";
export const AUTH_PERSIST_DISABLED_VALUE = "0";

/** Supabase auth cookie name pattern (sb-<ref>-auth-token[.N]). */
export function isSupabaseAuthTokenCookie(name: string): boolean {
  return /^sb-[\w-]+-auth-token(\.\d+)?$/.test(name);
}

/**
 * Max-Age for persistent auth cookies when "Stay logged in" is checked.
 * Must match Supabase Auth session time-box (Dashboard → Auth → Sessions).
 * When session time-box is disabled (indefinite), use a long browser-safe maxAge.
 * Set via AUTH_COOKIE_PERSIST_MAX_AGE_SECONDS (see scripts/probe-supabase-auth-session-config.ts).
 */
export function getAuthCookiePersistMaxAgeSeconds(): number {
  const raw = process.env.AUTH_COOKIE_PERSIST_MAX_AGE_SECONDS?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return AUTH_COOKIE_PERSIST_DEFAULT_MAX_AGE_SECONDS;
}

export function readAuthPersistEnabled(
  cookieValue: string | undefined | null,
): boolean {
  return cookieValue === AUTH_PERSIST_ENABLED_VALUE;
}

export function authPersistFlagCookieOptions(persist: boolean): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
  maxAge?: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    ...(persist
      ? { maxAge: getAuthCookiePersistMaxAgeSeconds() }
      : {}),
  };
}
