import type { SupabaseClient } from "@supabase/supabase-js";

export type EstablishRecoverySessionResult =
  | { ok: true }
  | { ok: false; error: string };

const EXPIRED_OR_INVALID =
  "This reset link is invalid or has expired. Please request a new one.";
const MISSING_PARAMS =
  "This reset link is invalid or missing required parameters.";

/**
 * Establish an Auth recovery session from the browser URL after a Supabase
 * password-reset email.
 *
 * Supabase may deliver credentials in any of these shapes depending on
 * template / flowType / GoTrue version:
 * 1. PKCE: `?code=…` → exchangeCodeForSession
 * 2. token_hash: `?token_hash=…&type=recovery` → verifyOtp
 * 3. implicit: `#access_token=…&refresh_token=…&type=recovery` → setSession
 *    (hash is invisible to server components; must be read client-side)
 *
 * Staging currently redirects from `/auth/v1/verify` into shape (3). The SSR
 * browser client defaults to `flowType: "pkce"`, so hash tokens are NOT
 * auto-consumed — we must call setSession explicitly.
 */
export async function establishRecoverySessionFromUrl(
  supabase: SupabaseClient,
): Promise<EstablishRecoverySessionResult> {
  if (typeof window === "undefined") {
    return { ok: false, error: MISSING_PARAMS };
  }

  const search = new URLSearchParams(window.location.search);

  // 1) PKCE authorization code
  const code = search.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return { ok: false, error: EXPIRED_OR_INVALID };
    }
    clearAuthParamsFromUrl();
    return { ok: true };
  }

  // 2) token_hash query (custom email templates)
  const tokenHash = search.get("token_hash");
  const queryType = search.get("type");
  if (tokenHash && queryType === "recovery") {
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: "recovery",
    });
    if (error) {
      return { ok: false, error: EXPIRED_OR_INVALID };
    }
    clearAuthParamsFromUrl();
    return { ok: true };
  }

  // 3) Implicit hash fragment (staging GoTrue verify → app redirect)
  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (rawHash) {
    const hashParams = new URLSearchParams(rawHash);
    const hashError =
      hashParams.get("error_description") ?? hashParams.get("error");
    if (hashError) {
      return { ok: false, error: EXPIRED_OR_INVALID };
    }

    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const hashType = hashParams.get("type");

    if (accessToken && refreshToken && hashType === "recovery") {
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (error) {
        return { ok: false, error: EXPIRED_OR_INVALID };
      }
      clearAuthParamsFromUrl();
      return { ok: true };
    }
  }

  // 4) Session already present (e.g. prior exchange / detectSessionInUrl)
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    return { ok: true };
  }

  return { ok: false, error: MISSING_PARAMS };
}

function clearAuthParamsFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("code");
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  url.hash = "";
  window.history.replaceState(
    {},
    document.title,
    `${url.pathname}${url.search}`,
  );
}
