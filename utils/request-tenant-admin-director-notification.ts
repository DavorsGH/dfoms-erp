/**
 * Best-effort client trigger for tenant Admin/Director in-app notifications.
 * The API resolves the creator label and tenant scope from the session.
 */
export function requestTenantAdminDirectorNotification(options: {
  title: string;
  detail: string;
  actionUrl?: string | null;
}): void {
  void fetch("/api/tenant-admin-notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  }).catch(() => {
    /* best-effort */
  });
}
