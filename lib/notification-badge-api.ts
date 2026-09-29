/** Notification badge poll endpoints (count-only or minimal list). */

export const DFOMS_MW_TIMING_HEADER = "x-dfoms-mw-ms";
export const DFOMS_ROUTE_TIMING_HEADER = "x-dfoms-route-ms";

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
