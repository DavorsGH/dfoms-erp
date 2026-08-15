import type { MfaGateStatus } from "./types";

/** Short-lived per-isolate MFA gate cache for Edge middleware (30–60s max). */
const MFA_GATE_CACHE_TTL_MS = 45_000;

type CacheEntry = {
  status: MfaGateStatus;
  expiresAtMs: number;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(authUid: string, sessionKey: string): string {
  return `${authUid}:${sessionKey}`;
}

export function getCachedMfaGateStatus(
  authUid: string,
  sessionKey: string | null,
): MfaGateStatus | null {
  if (!sessionKey) {
    return null;
  }

  const key = cacheKey(authUid, sessionKey);
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (entry.expiresAtMs <= Date.now()) {
    cache.delete(key);
    return null;
  }

  return entry.status;
}

export function setCachedMfaGateStatus(
  authUid: string,
  sessionKey: string | null,
  status: MfaGateStatus,
): void {
  if (!sessionKey) {
    return;
  }

  cache.set(cacheKey(authUid, sessionKey), {
    status,
    expiresAtMs: Date.now() + MFA_GATE_CACHE_TTL_MS,
  });
}

/** Call on sign-out, MFA enroll/unenroll, or admin MFA revoke. */
export function invalidateMfaGateCache(authUid: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${authUid}:`)) {
      cache.delete(key);
    }
  }
}
