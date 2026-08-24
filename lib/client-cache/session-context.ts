"use client";

import { createClient } from "@/utils/supabase/client";
import { CLIENT_CACHE_SESSION_STORAGE_KEY } from "@/lib/client-cache/constants";
import type { ClientCacheSession } from "@/lib/client-cache/keys";
import { assertCacheSession } from "@/lib/client-cache/keys";

export function rememberClientCacheSession(session: ClientCacheSession): void {
  if (typeof window === "undefined") return;
  try {
    assertCacheSession(session);
    window.localStorage.setItem(
      CLIENT_CACHE_SESSION_STORAGE_KEY,
      JSON.stringify({
        tenantId: session.tenantId,
        authUid: session.authUid,
      }),
    );
  } catch {
    // Non-fatal
  }
}

export function clearRememberedClientCacheSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(CLIENT_CACHE_SESSION_STORAGE_KEY);
  } catch {
    // Non-fatal
  }
}

export function readRememberedClientCacheSession(): ClientCacheSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CLIENT_CACHE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientCacheSession>;
    if (!parsed.tenantId?.trim() || !parsed.authUid?.trim()) return null;
    return { tenantId: parsed.tenantId, authUid: parsed.authUid };
  } catch {
    return null;
  }
}

/**
 * Resolve tenant+auth for cache/queue. Prefers live lookup; falls back to
 * remembered session when Auth/DB is unreachable (offline mid-session).
 */
export async function resolveClientCacheSession(): Promise<ClientCacheSession | null> {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const authUid = session?.user?.id;
  if (!authUid) {
    clearRememberedClientCacheSession();
    return null;
  }

  try {
    const { data: account, error: accountError } = await supabase
      .from("user_accounts")
      .select("tenant_id")
      .eq("auth_uid", authUid)
      .maybeSingle();

    if (!accountError && account?.tenant_id) {
      const resolved = { tenantId: account.tenant_id, authUid };
      rememberClientCacheSession(resolved);
      return resolved;
    }
  } catch {
    // Fall through to remembered session.
  }

  const remembered = readRememberedClientCacheSession();
  if (remembered && remembered.authUid === authUid) {
    return remembered;
  }

  return null;
}
