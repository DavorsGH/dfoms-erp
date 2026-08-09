import {
  getAuthCookiePersistMaxAgeSeconds,
  isSupabaseAuthTokenCookie,
} from "@/lib/auth/session-persistence";

type CookieToSet = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/**
 * Apply session vs persistent maxAge to Supabase auth token cookies.
 * When persist=false, strip maxAge/expires so the browser treats them as session cookies.
 */
export function applyAuthCookiePersistence(
  cookiesToSet: CookieToSet[],
  persist: boolean,
): CookieToSet[] {
  return cookiesToSet.map(({ name, value, options }) => {
    if (!isSupabaseAuthTokenCookie(name)) {
      return { name, value, options };
    }

    const nextOptions: Record<string, unknown> = { ...(options ?? {}) };

    if (persist) {
      nextOptions.maxAge = getAuthCookiePersistMaxAgeSeconds();
    } else {
      delete nextOptions.maxAge;
      delete nextOptions.expires;
    }

    return { name, value, options: nextOptions };
  });
}
