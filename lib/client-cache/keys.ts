/**
 * Every cache key MUST include tenant_id and auth_uid (when user-specific).
 * Format: t:{tenantId}:u:{authUid}:{namespace}
 */

export type ClientCacheSession = {
  tenantId: string;
  authUid: string;
};

export function assertCacheSession(session: ClientCacheSession): void {
  const tenantId = session.tenantId?.trim();
  const authUid = session.authUid?.trim();
  if (!tenantId || !authUid) {
    throw new Error("Client cache requires tenantId and authUid.");
  }
}

export function buildDashboardSummaryCacheKey(session: ClientCacheSession): string {
  assertCacheSession(session);
  return `t:${session.tenantId}:u:${session.authUid}:dashboard-summary`;
}

export function buildReferenceLookupsCacheKey(session: ClientCacheSession): string {
  assertCacheSession(session);
  return `t:${session.tenantId}:u:${session.authUid}:lookups:reference`;
}

/** Prefix for purging all keys belonging to one session. */
export function buildSessionCachePrefix(session: ClientCacheSession): string {
  assertCacheSession(session);
  return `t:${session.tenantId}:u:${session.authUid}:`;
}
