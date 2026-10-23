import type { User } from "@supabase/supabase-js";
import { readMustChangeState } from "@/utils/portal-login-access/must-change-state";
import { TEMP_PASSWORD_EXPIRED_MESSAGE } from "@/utils/portal-login-access/types";

export { TEMP_PASSWORD_EXPIRED_MESSAGE };

const SET_PASSWORD_PATHS = {
  lessee: "/portal/set-password",
  landlord: "/landlord-portal/set-password",
  facility_manager: "/facility-portal/set-password",
  staff: "/set-password",
} as const;

const LOGIN_PREFIXES = {
  lessee: "/portal/login",
  landlord: "/landlord-portal/login",
  facility_manager: "/facility-portal/login",
  staff: "/login",
} as const;

export type MustChangePersona = keyof typeof SET_PASSWORD_PATHS;

export function getMustChangePasswordRedirect(options: {
  user: User;
  pathname: string;
  persona: MustChangePersona;
}): string | null {
  const appMetadata =
    options.user.app_metadata && typeof options.user.app_metadata === "object"
      ? (options.user.app_metadata as Record<string, unknown>)
      : {};
  const state = readMustChangeState(appMetadata);
  if (!state.mustChange) {
    return null;
  }

  const setPasswordPath = SET_PASSWORD_PATHS[options.persona];
  const loginPrefix = LOGIN_PREFIXES[options.persona];

  if (
    options.pathname === setPasswordPath ||
    options.pathname === loginPrefix ||
    options.pathname.startsWith(`${loginPrefix}/`)
  ) {
    return null;
  }

  return setPasswordPath;
}

export function mustChangePasswordPublicPaths(): string[] {
  return Object.values(SET_PASSWORD_PATHS);
}
