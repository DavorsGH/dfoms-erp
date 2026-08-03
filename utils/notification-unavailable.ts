/** Shown when a notification deep-link target no longer exists. */
export const NOTIFICATION_TARGET_UNAVAILABLE_MESSAGE =
  "This item may have been removed or is no longer available";

/**
 * Rewrite known stale notification paths (pre-fix deep-links) to current
 * destinations. Safe to call on already-correct URLs (no-op).
 *
 * Old landlord pending-approval detail:
 *   /dashboard/real-estate/landlords/{uuid}
 * → /dashboard/real-estate/landlords?highlight={uuid}
 */
export function rewriteStaleNotificationPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;

  const match = trimmed.match(
    /^(\/dashboard\/real-estate\/landlords)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i,
  );
  if (match) {
    return `${match[1]}?highlight=${match[2]}`;
  }

  return trimmed;
}
