import type { SupabaseClient } from "@supabase/supabase-js";
import { getSafeNext } from "@/utils/safe-redirect";
import { getMfaGateStatus } from "./aal-gate";
import { isMfaEnforcementEnabled } from "./config";
import {
  getCachedMfaGateStatus,
  setCachedMfaGateStatus,
} from "./middleware-gate-cache";
import { deriveSessionKeyFromAuthSession } from "./session-key";
import {
  MFA_CHALLENGE_ROUTES,
  MFA_PENDING_PUBLIC_PATHS,
  type MfaGateStatus,
  type MfaPersona,
} from "./types";

function resolvePersona(options: {
  isLesseePortalUser: boolean;
  isLandlordPortalUser: boolean;
  isFacilityManagerPortalUser: boolean;
}): MfaPersona {
  if (options.isLesseePortalUser) return "lessee";
  if (options.isLandlordPortalUser) return "landlord";
  if (options.isFacilityManagerPortalUser) return "facility_manager";
  return "staff";
}

function isLoginPath(pathname: string, persona: MfaPersona): boolean {
  return pathname === MFA_CHALLENGE_ROUTES[persona].loginPath;
}

async function resolveMfaGateStatus(
  supabase: SupabaseClient,
  userId: string,
  sessionKey: string | null,
): Promise<MfaGateStatus> {
  const cached = getCachedMfaGateStatus(userId, sessionKey);
  if (cached !== null) {
    return cached;
  }

  const status = await getMfaGateStatus(supabase, userId, sessionKey);
  setCachedMfaGateStatus(userId, sessionKey, status);
  return status;
}

export async function getMfaChallengeRedirectPath(options: {
  supabase: SupabaseClient;
  userId: string;
  pathname: string;
  searchParams: URLSearchParams;
  isLesseePortalUser: boolean;
  isLandlordPortalUser: boolean;
  isFacilityManagerPortalUser: boolean;
}): Promise<string | null> {
  if (!isMfaEnforcementEnabled()) {
    return null;
  }

  if (MFA_PENDING_PUBLIC_PATHS.has(options.pathname)) {
    return null;
  }

  const persona = resolvePersona(options);
  const routes = MFA_CHALLENGE_ROUTES[persona];

  const {
    data: { session },
  } = await options.supabase.auth.getSession();

  const sessionKey =
    session?.access_token && session.refresh_token
      ? await deriveSessionKeyFromAuthSession(session)
      : null;

  const gateStatus = await resolveMfaGateStatus(
    options.supabase,
    options.userId,
    sessionKey,
  );

  if (gateStatus !== "pending") {
    return null;
  }

  const nextParam = options.searchParams.get("next");
  const returnPath =
    !isLoginPath(options.pathname, persona) &&
    options.pathname !== routes.challengePath
      ? `${options.pathname}${options.searchParams.toString() ? `?${options.searchParams.toString()}` : ""}`
      : null;

  const next = getSafeNext(returnPath ?? nextParam, routes.defaultNext);

  const params = new URLSearchParams();
  params.set("next", next);
  return `${routes.challengePath}?${params.toString()}`;
}

export async function shouldBlockLoginAutoRedirect(options: {
  supabase: SupabaseClient;
  userId: string;
  pathname: string;
  isLesseePortalUser: boolean;
  isLandlordPortalUser: boolean;
  isFacilityManagerPortalUser: boolean;
}): Promise<boolean> {
  if (!isMfaEnforcementEnabled()) {
    return false;
  }

  const persona = resolvePersona(options);
  if (!isLoginPath(options.pathname, persona)) {
    return false;
  }

  const {
    data: { session },
  } = await options.supabase.auth.getSession();

  const sessionKey =
    session?.access_token && session.refresh_token
      ? await deriveSessionKeyFromAuthSession(session)
      : null;

  const gateStatus = await resolveMfaGateStatus(
    options.supabase,
    options.userId,
    sessionKey,
  );

  return gateStatus === "pending";
}
