/** Shared copy for inactive / deleted account redirects (safe for client + server). */

export const ACCOUNT_NO_LONGER_ACTIVE_MESSAGE =
  "Your account is no longer active. Please contact your administrator.";

export const ACCOUNT_INACTIVE_NOTICE = "account_inactive";

export const SELF_ROLE_ACCESS_CHANGE_MESSAGE =
  "You can't change your own role or access. Ask another administrator.";

export function accountInactiveLoginPath(loginPath = "/login"): string {
  const url = new URL(loginPath, "http://local.invalid");
  url.searchParams.set("notice", ACCOUNT_INACTIVE_NOTICE);
  return `${url.pathname}${url.search}`;
}
