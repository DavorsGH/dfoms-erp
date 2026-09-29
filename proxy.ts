import { type NextRequest, NextResponse } from "next/server";
import { getSafeNext } from "@/utils/safe-redirect";
import { createClient } from "@/utils/supabase/middleware";
import {
  getMfaChallengeRedirectPath,
  shouldBlockLoginAutoRedirect,
} from "@/lib/mfa/middleware-gate";
import { MFA_CHALLENGE_ROUTES } from "@/lib/mfa/types";
import {
  AUTH_CONTEXT_HEADER,
  isMiddlewareContextSigningConfigured,
  signAuthContext,
} from "@/lib/middleware-auth-context";
import {
  resolveMiddlewarePersona,
  type MiddlewareAccountRow,
} from "@/lib/middleware-persona";
import {
  isAuthRejectionError,
  isNetworkAuthError,
} from "@/lib/auth/middleware-resolve-user";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildBadgeAuthContextPayload,
  signBadgeAuthContext,
} from "@/lib/middleware-badge-auth-context";
import {
  DFOMS_MW_AUTH_TIMING_HEADER,
  DFOMS_MW_DB_TIMING_HEADER,
  DFOMS_MW_SECRET_CONFIGURED_HEADER,
  DFOMS_MW_SIGN_REASON_HEADER,
  DFOMS_MW_SIGNED_HEADER,
  DFOMS_MW_SIGN_TIMING_HEADER,
  DFOMS_MW_TIMING_HEADER,
  isNotificationBadgeApiRequest,
} from "@/lib/notification-badge-api";
import {
  buildSanitizedRequestHeaders,
  proxyPassthrough,
} from "@/lib/middleware-proxy-headers";
import {
  DFOMS_MW_REGION_HEADER,
  DFOMS_MW_RTT1_HEADER,
  DFOMS_MW_RTT2_HEADER,
  getVercelRegion,
} from "@/lib/perf-probe-headers";
import {
  DFOMS_PERF_LAYOUT_PROBE_HEADER,
  measureSupabaseHealthRttTwice,
} from "@/lib/supabase-http-perf";
import { createPerfProbe, isPerfProbeEnabled } from "@/utils/perf-probe";
import { PRODUCTION_PORTAL_SITE_URL } from "@/utils/public-site-url";

const LEGACY_PORTAL_HOST = "portal.davorsfacilities.com";

/** Redirect to a validated relative path+query (pathname + search). */
function redirectToRelativePath(request: NextRequest, relativePath: string) {
  const target = new URL(relativePath, request.nextUrl.origin);
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  url.search = target.search;
  url.hash = "";
  return NextResponse.redirect(url);
}

/**
 * Persona "home" redirects must never carry invite tokens or other query
 * params from the page that triggered the bounce.
 */
function redirectHomeClean(request: NextRequest, homePath: string) {
  const url = request.nextUrl.clone();
  url.pathname = homePath;
  url.search = "";
  url.hash = "";
  return NextResponse.redirect(url);
}

/** Invite acceptance must stay reachable regardless of active persona session. */
const ACCEPT_INVITE_PATHS = new Set([
  "/accept-invite",
  "/portal/accept-invite",
  "/landlord-portal/accept-invite",
  "/facility-portal/accept-invite",
]);

function isAcceptInvitePath(pathname: string): boolean {
  return ACCEPT_INVITE_PATHS.has(pathname);
}

/** Minimal User for proxy persona/MFA/signing; identity from verified JWT claims only. */
function middlewareUserFromClaims(
  claims: Record<string, unknown> & { sub: string },
): User {
  const userMetadata =
    claims.user_metadata && typeof claims.user_metadata === "object"
      ? (claims.user_metadata as User["user_metadata"])
      : {};
  const appMetadata =
    claims.app_metadata && typeof claims.app_metadata === "object"
      ? (claims.app_metadata as User["app_metadata"])
      : {};

  return {
    id: claims.sub,
    aud: typeof claims.aud === "string" ? claims.aud : "authenticated",
    role: typeof claims.role === "string" ? claims.role : "authenticated",
    email:
      typeof claims.email === "string"
        ? claims.email
        : typeof userMetadata?.email === "string"
          ? userMetadata.email
          : undefined,
    phone: typeof claims.phone === "string" ? claims.phone : "",
    app_metadata: appMetadata,
    user_metadata: userMetadata,
    created_at: typeof claims.created_at === "string" ? claims.created_at : "",
  };
}

/**
 * Local JWT verify via getClaims() (JWKS for ES256). getSession() inside getClaims
 * refreshes expired access tokens and writes cookies on the middleware response.
 */
async function resolveProxyAuthUser(supabase: SupabaseClient): Promise<{
  user: User | null;
  trustedLocalSession: boolean;
}> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      return {
        user: middlewareUserFromClaims(
          data.claims as Record<string, unknown> & { sub: string },
        ),
        trustedLocalSession: false,
      };
    }
    if (error) {
      if (isAuthRejectionError(error)) {
        return { user: null, trustedLocalSession: false };
      }
      if (isNetworkAuthError(error)) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user) {
          return { user: session.user, trustedLocalSession: true };
        }
      }
      return { user: null, trustedLocalSession: false };
    }
    return { user: null, trustedLocalSession: false };
  } catch (error) {
    if (isAuthRejectionError(error)) {
      return { user: null, trustedLocalSession: false };
    }
    if (isNetworkAuthError(error)) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        return { user: session.user, trustedLocalSession: true };
      }
      return { user: null, trustedLocalSession: false };
    }
    console.error(
      "[proxy-auth] unexpected getClaims error",
      error instanceof Error ? error.message : error,
    );
    return { user: null, trustedLocalSession: false };
  }
}

const ACCOUNT_SETTINGS_ALIASES: Record<string, string> = {
  "/portal/account-security": "/portal/account",
  "/portal/account-security/mfa": "/portal/account/mfa",
  "/landlord-portal/administration/account-security": "/landlord-portal/account",
  "/landlord-portal/administration/account-security/mfa":
    "/landlord-portal/account/mfa",
};

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (process.env.LEGACY_DOMAIN_REDIRECT === "on" && !pathname.startsWith("/api/")) {
    const rawHost =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    const host = rawHost.split(",")[0]?.trim().split(":")[0]?.toLowerCase() ?? "";
    if (host === LEGACY_PORTAL_HOST) {
      const target = new URL(
        `${pathname}${request.nextUrl.search}`,
        PRODUCTION_PORTAL_SITE_URL,
      );
      return NextResponse.redirect(target, 301);
    }
  }

  const accountAliasTarget = ACCOUNT_SETTINGS_ALIASES[pathname];
  if (accountAliasTarget) {
    return redirectToRelativePath(request, accountAliasTarget);
  }

  // External cron keepalive — must stay reachable without a session.
  if (pathname === "/api/heartbeat") {
    return proxyPassthrough(request);
  }

  // Web Push VAPID public key — no auth; used before subscribe permission prompt.
  if (pathname === "/api/push/vapid-public-key") {
    return proxyPassthrough(request);
  }

  // Vercel Cron jobs — authenticated inside each route via CRON_SECRET.
  if (pathname.startsWith("/api/cron/")) {
    return proxyPassthrough(request);
  }

  // External webhooks — public POST; signature verified inside each route.
  if (pathname.startsWith("/api/webhooks/")) {
    return proxyPassthrough(request);
  }

  // Product-sale Paystack callback — public thank-you / verify page for payers.
  if (pathname.startsWith("/pay/product-sale")) {
    return proxyPassthrough(request);
  }

  // Public email/SMS unsubscribe links (no auth).
  if (
    pathname.startsWith("/unsubscribe") ||
    pathname.startsWith("/api/unsubscribe")
  ) {
    return proxyPassthrough(request);
  }

  // Internal SMS short-link redirects (no auth; route 302s to destination).
  if (pathname.startsWith("/s/")) {
    return proxyPassthrough(request);
  }

  // OAuth start/callback — public; flow validated via signed cookie in-route.
  if (
    pathname === "/auth/start" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/error"
  ) {
    return proxyPassthrough(request);
  }

  // Portal invite acceptance / landlord self-signup APIs — public; validate in-route.
  if (
    pathname === "/api/portal/accept-invite" ||
    pathname === "/api/landlord-portal/accept-invite" ||
    pathname === "/api/facility-portal/accept-invite" ||
    pathname === "/api/landlord-portal/signup" ||
    pathname === "/api/staff/accept-invite"
  ) {
    return proxyPassthrough(request);
  }

  // Public rental application form (token in path); APIs validate hashed token.
  if (pathname.startsWith("/apply/") || pathname.startsWith("/api/apply/")) {
    return proxyPassthrough(request);
  }

  // Maintenance mode — blocks all access except heartbeat and the maintenance page itself.
  if (process.env.MAINTENANCE_MODE === "true") {
    if (pathname === "/maintenance") {
      return proxyPassthrough(request);
    }
    const url = request.nextUrl.clone();
    url.pathname = "/maintenance";
    url.search = "";
    url.hash = "";
    return NextResponse.redirect(url);
  }

  const badgeApiRequestEarly = isNotificationBadgeApiRequest(
    pathname,
    request.nextUrl.searchParams,
  );
  let mwAuthMs = 0;
  let mwDbMs = 0;
  let mwSignMs = 0;

  const perf = createPerfProbe();
  const { supabase, response } = createClient(request, {
    onSupabaseAuthHttp: () => perf.countAuth(),
  });

  const authStartedAt = Date.now();
  const { user, trustedLocalSession } = await resolveProxyAuthUser(supabase);
  mwAuthMs = Date.now() - authStartedAt;
  if (trustedLocalSession) {
    // Cookie JWT accepted without Auth network verify (offline / Auth unreachable).
    response.headers.set("x-dfoms-auth-local-session", "1");
  }

  const isPortalPath = pathname.startsWith("/portal");
  const isLandlordPortalPath = pathname.startsWith("/landlord-portal");
  const isFacilityPortalPath = pathname.startsWith("/facility-portal");
  const isPortalPublicPath =
    pathname === "/portal/login" ||
    pathname === "/portal/forgot-password" ||
    pathname === "/portal/reset-password" ||
    pathname === "/portal/accept-invite";
  const isLandlordPortalPublicPath =
    pathname === "/landlord-portal/login" ||
    pathname === "/landlord-portal/forgot-password" ||
    pathname === "/landlord-portal/reset-password" ||
    pathname === "/landlord-portal/accept-invite" ||
    pathname === "/landlord-portal/signup" ||
    pathname === "/landlord-portal/verify-email";
  const isFacilityPortalPublicPath =
    pathname === "/facility-portal/login" ||
    pathname === "/facility-portal/forgot-password" ||
    pathname === "/facility-portal/reset-password" ||
    pathname === "/facility-portal/accept-invite";

  const publicPaths = new Set([
    "/", // Public portal chooser (landlord / tenant) — no auth redirects from here
    "/login",
    "/login/mfa",
    "/signup",
    "/accept-invite",
    "/auth/start",
    "/auth/callback",
    "/auth/error",
    "/api/signup",
    "/api/webhooks/paystack",
    "/api/webhooks/resend",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/offline",
    "/portal/login",
    "/portal/login/mfa",
    "/portal/forgot-password",
    "/portal/reset-password",
    "/portal/accept-invite",
    "/landlord-portal/login",
    "/landlord-portal/login/mfa",
    "/landlord-portal/forgot-password",
    "/landlord-portal/reset-password",
    "/landlord-portal/accept-invite",
    "/landlord-portal/signup",
    "/landlord-portal/verify-email",
    "/api/landlord-portal/signup",
    "/facility-portal/login",
    "/facility-portal/login/mfa",
    "/facility-portal/forgot-password",
    "/facility-portal/reset-password",
    "/facility-portal/accept-invite",
  ]);

  if (
    !user &&
    !publicPaths.has(pathname) &&
    !pathname.startsWith("/pay/product-sale") &&
    !pathname.startsWith("/unsubscribe") &&
    !pathname.startsWith("/api/unsubscribe") &&
    !pathname.startsWith("/s/") &&
    !pathname.startsWith("/apply/") &&
    !pathname.startsWith("/api/apply/") &&
    !pathname.startsWith("/api/cron/")
  ) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const url = request.nextUrl.clone();
    if (isLandlordPortalPath) {
      url.pathname = "/landlord-portal/login";
    } else if (isFacilityPortalPath) {
      url.pathname = "/facility-portal/login";
    } else if (isPortalPath) {
      url.pathname = "/portal/login";
    } else {
      url.pathname = "/login";
    }
    // Preserve destination for staff login only (portals keep their own default).
    url.search = "";
    if (!isPortalPath && !isLandlordPortalPath && !isFacilityPortalPath) {
      const returnPath = `${pathname}${request.nextUrl.search}`;
      url.searchParams.set("next", returnPath);
    }
    return NextResponse.redirect(url);
  }

  const needsAccountGate =
    user &&
    pathname !== "/login" &&
    !isPortalPublicPath &&
    !isLandlordPortalPublicPath &&
    !isFacilityPortalPublicPath;

  const needsPersonaCheck =
    user &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/accept-invite" ||
      isPortalPublicPath ||
      isLandlordPortalPublicPath ||
      isFacilityPortalPublicPath ||
      (isPortalPath && !isPortalPublicPath) ||
      (isLandlordPortalPath && !isLandlordPortalPublicPath) ||
      (isFacilityPortalPath && !isFacilityPortalPublicPath) ||
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/pos-customer-display"));

  let accountRow: MiddlewareAccountRow | null = null;
  let accountGate = false;

  if (user && (needsAccountGate || needsPersonaCheck)) {
    accountGate = true;
    const accountDbStartedAt = Date.now();
    const { data: account } = await supabase
      .from("user_accounts")
      .select(
        "is_active, tenant_id, role, employee_id, client_id, active_business_unit_id, view_all_business_units",
      )
      .eq("auth_uid", user.id)
      .maybeSingle();
    mwDbMs += Date.now() - accountDbStartedAt;
    perf.countDb();

    accountRow = account ?? null;

    if (needsAccountGate && accountRow?.is_active === false) {
      await supabase.auth.signOut();
      return redirectHomeClean(request, "/login");
    }
  }

  let isLesseePortalUser = false;
  let isLandlordPortalUser = false;
  let isFacilityManagerPortalUser = false;
  let resolvedPortal: "staff" | "lessee" | "landlord" | "facility_manager" =
    "staff";

  if (needsPersonaCheck) {
    const persona = await resolveMiddlewarePersona({
      supabase,
      user,
      pathname,
      accountRow,
    });
    isLesseePortalUser = persona.isLesseePortalUser;
    isLandlordPortalUser = persona.isLandlordPortalUser;
    isFacilityManagerPortalUser = persona.isFacilityManagerPortalUser;
    resolvedPortal = persona.portal;
    if (persona.extraDbCalls > 0) {
      perf.countDb(persona.extraDbCalls);
    } else if (
      pathname.startsWith("/dashboard") &&
      accountRow &&
      !user.user_metadata?.portal
    ) {
      perf.countSkippedDb(3);
    } else if (user.user_metadata?.portal) {
      perf.countSkippedDb(3);
    }
  }

  // MFA gate — must run before persona routing and login → dashboard redirects.
  // Skip when Auth could not be network-verified (offline); do not bounce mid-session.
  if (user && needsPersonaCheck && !trustedLocalSession) {
    const mfaRedirect = await getMfaChallengeRedirectPath({
      supabase,
      userId: user.id,
      pathname,
      searchParams: request.nextUrl.searchParams,
      isLesseePortalUser,
      isLandlordPortalUser,
      isFacilityManagerPortalUser,
    });
    if (mfaRedirect) {
      return redirectToRelativePath(request, mfaRedirect);
    }
  }

  // Authenticated lessees use /portal/*, not staff /dashboard or other portals.
  // Accept-invite pages stay reachable so a different persona's invite can be completed.
  if (
    user &&
    isLesseePortalUser &&
    !isAcceptInvitePath(pathname) &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/dashboard") ||
      isLandlordPortalPath ||
      isFacilityPortalPath)
  ) {
    return redirectHomeClean(request, "/portal/dashboard");
  }

  // Authenticated landlords use /landlord-portal/*, not staff /dashboard or other portals.
  if (
    user &&
    isLandlordPortalUser &&
    !isAcceptInvitePath(pathname) &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/dashboard") ||
      isPortalPath ||
      isFacilityPortalPath)
  ) {
    return redirectHomeClean(request, "/landlord-portal/dashboard");
  }

  // Authenticated facility managers use /facility-portal/*.
  if (
    user &&
    isFacilityManagerPortalUser &&
    !isAcceptInvitePath(pathname) &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/dashboard") ||
      isPortalPath ||
      isLandlordPortalPath)
  ) {
    return redirectHomeClean(request, "/facility-portal/dashboard");
  }

  if (
    user &&
    !isLesseePortalUser &&
    !isLandlordPortalUser &&
    !isFacilityManagerPortalUser &&
    (pathname === "/login" || pathname === "/signup")
  ) {
    const blockDashboardRedirect = await shouldBlockLoginAutoRedirect({
      supabase,
      userId: user.id,
      pathname,
      isLesseePortalUser,
      isLandlordPortalUser,
      isFacilityManagerPortalUser,
    });
    if (!blockDashboardRedirect) {
      const nextParam =
        pathname === "/login"
          ? request.nextUrl.searchParams.get("next")
          : null;
      return redirectToRelativePath(
        request,
        getSafeNext(nextParam, "/dashboard"),
      );
    }
    const nextParam = request.nextUrl.searchParams.get("next");
    return redirectToRelativePath(
      request,
      `${MFA_CHALLENGE_ROUTES.staff.challengePath}?next=${encodeURIComponent(getSafeNext(nextParam, "/dashboard"))}`,
    );
  }

  if (
    user &&
    isPortalPublicPath &&
    isLesseePortalUser &&
    !isAcceptInvitePath(pathname)
  ) {
    const blockRedirect = await shouldBlockLoginAutoRedirect({
      supabase,
      userId: user.id,
      pathname: "/portal/login",
      isLesseePortalUser,
      isLandlordPortalUser,
      isFacilityManagerPortalUser,
    });
    if (!blockRedirect) {
      return redirectHomeClean(request, "/portal/dashboard");
    }
    const nextParam = request.nextUrl.searchParams.get("next");
    return redirectToRelativePath(
      request,
      `${MFA_CHALLENGE_ROUTES.lessee.challengePath}?next=${encodeURIComponent(getSafeNext(nextParam, "/portal/dashboard"))}`,
    );
  }

  if (
    user &&
    isLandlordPortalPublicPath &&
    isLandlordPortalUser &&
    !isAcceptInvitePath(pathname)
  ) {
    const blockRedirect = await shouldBlockLoginAutoRedirect({
      supabase,
      userId: user.id,
      pathname: "/landlord-portal/login",
      isLesseePortalUser,
      isLandlordPortalUser,
      isFacilityManagerPortalUser,
    });
    if (!blockRedirect) {
      return redirectHomeClean(request, "/landlord-portal/dashboard");
    }
    const nextParam = request.nextUrl.searchParams.get("next");
    return redirectToRelativePath(
      request,
      `${MFA_CHALLENGE_ROUTES.landlord.challengePath}?next=${encodeURIComponent(getSafeNext(nextParam, "/landlord-portal/dashboard"))}`,
    );
  }

  if (
    user &&
    isFacilityPortalPublicPath &&
    isFacilityManagerPortalUser &&
    !isAcceptInvitePath(pathname)
  ) {
    const blockRedirect = await shouldBlockLoginAutoRedirect({
      supabase,
      userId: user.id,
      pathname: "/facility-portal/login",
      isLesseePortalUser,
      isLandlordPortalUser,
      isFacilityManagerPortalUser,
    });
    if (!blockRedirect) {
      return redirectHomeClean(request, "/facility-portal/dashboard");
    }
    const nextParam = request.nextUrl.searchParams.get("next");
    return redirectToRelativePath(
      request,
      `${MFA_CHALLENGE_ROUTES.facility_manager.challengePath}?next=${encodeURIComponent(getSafeNext(nextParam, "/facility-portal/dashboard"))}`,
    );
  }

  // Non-lessee sessions cannot use the tenant portal dashboard.
  if (user && isPortalPath && !isPortalPublicPath && !isLesseePortalUser) {
    return redirectHomeClean(
      request,
      isLandlordPortalUser
        ? "/landlord-portal/dashboard"
        : isFacilityManagerPortalUser
          ? "/facility-portal/dashboard"
          : "/dashboard",
    );
  }

  // Non-landlord sessions cannot use the landlord portal dashboard.
  if (
    user &&
    isLandlordPortalPath &&
    !isLandlordPortalPublicPath &&
    !isLandlordPortalUser
  ) {
    return redirectHomeClean(
      request,
      isLesseePortalUser
        ? "/portal/dashboard"
        : isFacilityManagerPortalUser
          ? "/facility-portal/dashboard"
          : "/dashboard",
    );
  }

  // Non-facility-manager sessions cannot use the facility portal dashboard.
  if (
    user &&
    isFacilityPortalPath &&
    !isFacilityPortalPublicPath &&
    !isFacilityManagerPortalUser
  ) {
    return redirectHomeClean(
      request,
      isLesseePortalUser
        ? "/portal/dashboard"
        : isLandlordPortalUser
          ? "/landlord-portal/dashboard"
          : "/dashboard",
    );
  }

  // Trial / suspension enforcement runs in app/dashboard/layout.tsx only — not on
  // /trial-expired, /account-suspended, /login, /signup, or /api/signup.

  const requestHeaders = buildSanitizedRequestHeaders(request.headers);
  requestHeaders.set("x-pathname", pathname);
  if (isPerfProbeEnabled() && pathname.startsWith("/dashboard")) {
    requestHeaders.set(DFOMS_PERF_LAYOUT_PROBE_HEADER, "1");
  }

  const badgeApiRequest = badgeApiRequestEarly;
  let badgeSignReason = badgeApiRequest ? "not-attempted" : "n/a";

  if (user && badgeApiRequest && !trustedLocalSession) {
    if (!isMiddlewareContextSigningConfigured()) {
      badgeSignReason = "no-signing-secret";
    }
    const badgeDbStartedAt = Date.now();
    const badgePayload = await buildBadgeAuthContextPayload({
      supabase,
      user,
      pathname,
      searchParams: request.nextUrl.searchParams,
      accountRow,
      onDbCall: (count = 1) => perf.countDb(count),
    });
    mwDbMs += Date.now() - badgeDbStartedAt;
    if (!badgePayload) {
      if (badgeSignReason === "not-attempted") {
        badgeSignReason = "no-badge-payload";
      }
    } else if (!isMiddlewareContextSigningConfigured()) {
      badgeSignReason = "no-signing-secret";
    } else {
      const signStartedAt = Date.now();
      const signedBadge = await signBadgeAuthContext(badgePayload);
      mwSignMs = Date.now() - signStartedAt;
      if (signedBadge) {
        requestHeaders.set(AUTH_CONTEXT_HEADER, signedBadge);
        badgeSignReason = "signed";
      } else {
        badgeSignReason = "sign-returned-null";
      }
    }
  } else if (badgeApiRequest && user && trustedLocalSession) {
    badgeSignReason = "unverified-session";
  } else if (badgeApiRequest && !user) {
    badgeSignReason = "no-user";
  }

  if (
    user &&
    !trustedLocalSession &&
    accountRow &&
    accountRow.is_active !== false &&
    (pathname.startsWith("/dashboard") ||
      pathname.startsWith("/pos-customer-display") ||
      (isPerfProbeEnabled() &&
        pathname === "/api/perf-probe/trusted-context"))
  ) {
    const signed = await signAuthContext({
      authUid: user.id,
      tenantId: accountRow.tenant_id,
      role: accountRow.role,
      employeeId: accountRow.employee_id,
      clientId: accountRow.client_id,
      activeBusinessUnitId: accountRow.active_business_unit_id,
      viewAllBusinessUnits: accountRow.view_all_business_units === true,
      isActive: accountRow.is_active ?? true,
      portal: resolvedPortal,
      email: user.email ?? null,
    });
    if (signed) {
      requestHeaders.set(AUTH_CONTEXT_HEADER, signed);
    }
  }

  const nextResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.cookies.getAll().forEach((cookie) => {
    nextResponse.cookies.set(cookie);
  });

  // Supabase SSR may rebuild NextResponse.next({ request }) without proxy overrides;
  // never copy x-middleware-* or auth context from that object onto our final response.
  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === "set-cookie") {
      return;
    }
    if (lower.startsWith("x-middleware")) {
      return;
    }
    if (lower === AUTH_CONTEXT_HEADER) {
      return;
    }
    nextResponse.headers.set(key, value);
  });

  nextResponse.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate",
  );

  if (badgeApiRequest) {
    nextResponse.headers.set(
      DFOMS_MW_TIMING_HEADER,
      String(perf.elapsedMs()),
    );
    nextResponse.headers.set(DFOMS_MW_AUTH_TIMING_HEADER, String(mwAuthMs));
    nextResponse.headers.set(DFOMS_MW_DB_TIMING_HEADER, String(mwDbMs));
    nextResponse.headers.set(DFOMS_MW_SIGN_TIMING_HEADER, String(mwSignMs));
    // TEMP Phase 2A — remove after trust path verified in dev + prod-local
    if (process.env.DFOMS_TRUST_DIAG === "true") {
      nextResponse.headers.set(
        DFOMS_MW_SIGNED_HEADER,
        badgeSignReason === "signed" ? "yes" : "no",
      );
      nextResponse.headers.set(DFOMS_MW_SIGN_REASON_HEADER, badgeSignReason);
      nextResponse.headers.set(
        DFOMS_MW_SECRET_CONFIGURED_HEADER,
        isMiddlewareContextSigningConfigured() ? "yes" : "no",
      );
    }
    if (isPerfProbeEnabled()) {
      nextResponse.headers.set(DFOMS_MW_REGION_HEADER, getVercelRegion());
      const { rtt1Ms, rtt2Ms } = await measureSupabaseHealthRttTwice();
      nextResponse.headers.set(DFOMS_MW_RTT1_HEADER, String(rtt1Ms));
      nextResponse.headers.set(DFOMS_MW_RTT2_HEADER, String(rtt2Ms));
    }
  }

  if (isPerfProbeEnabled()) {
    for (const [key, value] of Object.entries(perf.toHeaderValues())) {
      nextResponse.headers.set(key, value);
    }
    if (pathname.startsWith("/dashboard")) {
      nextResponse.headers.set(DFOMS_MW_REGION_HEADER, getVercelRegion());
      nextResponse.headers.set(DFOMS_MW_AUTH_TIMING_HEADER, String(mwAuthMs));
      nextResponse.headers.set(DFOMS_MW_DB_TIMING_HEADER, String(mwDbMs));
    }
    console.info(
      "[perf] middleware",
      pathname,
      JSON.stringify({
        ms: perf.elapsedMs(),
        authCalls: perf.authCalls,
        dbCalls: perf.dbCalls,
        skippedAuthCalls: perf.skippedAuthCalls,
        skippedDbCalls: perf.skippedDbCalls,
        accountGate,
      }),
    );
  }

  return nextResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
  regions: ["arn1"],
};
