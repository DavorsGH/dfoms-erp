import type { SupabaseClient } from "@supabase/supabase-js";
import { getSafeNext } from "@/utils/safe-redirect";
import { getMfaGateStatus } from "./aal-gate";
import { isMfaEnforcementEnabled, readMfaEnforcementRaw } from "./config";
import { mfaDebugLog } from "./debug-log";
import { deriveSessionKeyFromAuthSession } from "./session-key";
import {
  MFA_CHALLENGE_ROUTES,
  MFA_PENDING_PUBLIC_PATHS,
  type MfaPersona,
} from "./types";

function resolvePersona(options: {
  isLesseePortalUser: boolean;
  isLandlordPortalUser: boolean;
}): MfaPersona {
  if (options.isLesseePortalUser) return "lessee";
  if (options.isLandlordPortalUser) return "landlord";
  return "staff";
}

function isLoginPath(pathname: string, persona: MfaPersona): boolean {
  return pathname === MFA_CHALLENGE_ROUTES[persona].loginPath;
}

export async function getMfaChallengeRedirectPath(options: {
  supabase: SupabaseClient;
  userId: string;
  pathname: string;
  searchParams: URLSearchParams;
  isLesseePortalUser: boolean;
  isLandlordPortalUser: boolean;
}): Promise<string | null> {
  const enforcementOn = isMfaEnforcementEnabled();
  mfaDebugLog("middleware-gate.getMfaChallengeRedirectPath", {
    pathname: options.pathname,
    userId: options.userId,
    enforcementOn,
    enforcementRaw: readMfaEnforcementRaw() ?? "(unset)",
    isLesseePortalUser: options.isLesseePortalUser,
    isLandlordPortalUser: options.isLandlordPortalUser,
  });

  if (!enforcementOn) {
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

  const gateStatus = await getMfaGateStatus(
    options.supabase,
    options.userId,
    sessionKey,
  );

  mfaDebugLog("middleware-gate.getMfaChallengeRedirectPath.gateStatus", {
    pathname: options.pathname,
    userId: options.userId,
    gateStatus,
    persona,
  });

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
}): Promise<boolean> {
  const enforcementOn = isMfaEnforcementEnabled();
  mfaDebugLog("middleware-gate.shouldBlockLoginAutoRedirect", {
    pathname: options.pathname,
    userId: options.userId,
    enforcementOn,
    enforcementRaw: readMfaEnforcementRaw() ?? "(unset)",
  });

  if (!enforcementOn) {
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

  const gateStatus = await getMfaGateStatus(
    options.supabase,
    options.userId,
    sessionKey,
  );

  mfaDebugLog("middleware-gate.shouldBlockLoginAutoRedirect.gateStatus", {
    pathname: options.pathname,
    userId: options.userId,
    gateStatus,
    block: gateStatus === "pending",
  });

  return gateStatus === "pending";
}
