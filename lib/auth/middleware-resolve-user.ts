import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Auth errors that mean the session is invalid/revoked (force login),
 * as opposed to transient network failures (keep local session).
 */
export function isAuthRejectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const err = error as {
    name?: string;
    status?: number;
    code?: string;
    message?: string;
  };

  if (err.name === "AuthRetryableFetchError") {
    return false;
  }

  const status = err.status;
  if (status === 401 || status === 403) {
    return true;
  }

  const code = (err.code ?? "").toLowerCase();
  if (
    code.includes("session_not_found") ||
    code.includes("refresh_token") ||
    code.includes("user_not_found") ||
    code === "invalid_token"
  ) {
    return true;
  }

  const message = (err.message ?? "").toLowerCase();
  if (
    message.includes("invalid jwt") ||
    message.includes("session missing") ||
    message.includes("user from sub claim") ||
    message.includes("not authenticated")
  ) {
    return true;
  }

  return false;
}

export function isNetworkAuthError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return true;
  }

  if (isAuthRejectionError(error)) {
    return false;
  }

  const err = error as {
    name?: string;
    status?: number;
    message?: string;
  };

  if (err.name === "AuthRetryableFetchError") {
    return true;
  }

  const status = err.status;
  if (status != null && status >= 500) {
    return true;
  }

  const message = (err.message ?? "").toLowerCase();
  return (
    message.includes("fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econn") ||
    message.includes("failed to fetch") ||
    message === "{}" ||
    message === ""
  );
}

export type ResolveMiddlewareUserResult = {
  user: User | null;
  /** True when we accepted cookie JWT without a successful Auth network verify. */
  trustedLocalSession: boolean;
};

/**
 * Prefer local cookie session so offline / flaky Auth does not bounce users to login.
 * Still calls getUser() when a session exists; on network failure, keep session.user.
 * On definitive Auth rejection, clear to null (login redirect).
 */
export async function resolveMiddlewareAuthUser(
  supabase: SupabaseClient,
): Promise<ResolveMiddlewareUserResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    return { user: null, trustedLocalSession: false };
  }

  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
      if (isNetworkAuthError(error)) {
        return { user: session.user, trustedLocalSession: true };
      }
      return { user: null, trustedLocalSession: false };
    }
    if (!data.user) {
      return { user: null, trustedLocalSession: false };
    }
    return { user: data.user, trustedLocalSession: false };
  } catch (error) {
    if (isAuthRejectionError(error)) {
      return { user: null, trustedLocalSession: false };
    }
    return { user: session.user, trustedLocalSession: true };
  }
}
