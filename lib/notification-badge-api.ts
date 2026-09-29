/** Notification badge poll endpoints (count-only or minimal list). */

export const DFOMS_MW_TIMING_HEADER = "x-dfoms-mw-ms";
export const DFOMS_MW_AUTH_TIMING_HEADER = "x-dfoms-mw-auth-ms";
export const DFOMS_MW_DB_TIMING_HEADER = "x-dfoms-mw-db-ms";
export const DFOMS_MW_SIGN_TIMING_HEADER = "x-dfoms-mw-sign-ms";
/** Dev-only: whether proxy attached a signed auth context on this request. */
export const DFOMS_MW_SIGNED_HEADER = "x-dfoms-mw-signed";
export const DFOMS_MW_SIGN_REASON_HEADER = "x-dfoms-mw-sign-reason";
export const DFOMS_MW_SECRET_CONFIGURED_HEADER = "x-dfoms-mw-secret-configured";

export const DFOMS_ROUTE_TIMING_HEADER = "x-dfoms-route-ms";
export const DFOMS_ROUTE_SETUP_TIMING_HEADER = "x-dfoms-route-setup-ms";
export const DFOMS_ROUTE_TRUST_TIMING_HEADER = "x-dfoms-route-trust-ms";
export const DFOMS_ROUTE_DB_TIMING_HEADER = "x-dfoms-route-db-ms";

export function isNotificationBadgeApiRequest(
  pathname: string,
  searchParams: URLSearchParams,
): boolean {
  const countOnly =
    searchParams.get("countOnly") === "1" ||
    searchParams.get("countOnly") === "true";

  if (pathname === "/api/employee-notifications") {
    return countOnly;
  }
  if (
    pathname === "/api/portal/notifications" ||
    pathname === "/api/landlord-portal/notifications"
  ) {
    return countOnly;
  }
  if (pathname === "/api/client-portal/notifications") {
    const limit = searchParams.get("limit");
    const offset = searchParams.get("offset") ?? "0";
    return limit === "1" && offset === "0";
  }
  return false;
}
