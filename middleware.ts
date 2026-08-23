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
  signAuthContext,
} from "@/lib/middleware-auth-context";
import {
  resolveMiddlewarePersona,
  type MiddlewareAccountRow,
} from "@/lib/middleware-persona";
import { createPerfProbe, isPerfProbeEnabled } from "@/utils/perf-probe";

/** Redirect to a validated relative path+query (pathname + search). */
function redirectToRelativePath(request: NextRequest, relativePath: string) {
  const target = new URL(relativePath, request.nextUrl.origin);
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  url.search = target.search;
  url.hash = "";
  return NextResponse.redirect(url);
}

const ACCOUNT_SETTINGS_ALIASES: Record<string, string> = {
  "/portal/account-security": "/portal/account",
  "/portal/account-security/mfa": "/portal/account/mfa",
  "/landlord-portal/administration/account-security": "/landlord-portal/account",
  "/landlord-portal/administration/account-security/mfa":
    "/landlord-portal/account/mfa",
};

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const accountAliasTarget = ACCOUNT_SETTINGS_ALIASES[pathname];
  if (accountAliasTarget) {
    return redirectToRelativePath(request, accountAliasTarget);
  }

  // External cron keepalive — must stay reachable without a session.
  if (pathname === "/api/heartbeat") {
    return NextResponse.next();
  }

  // Web Push VAPID public key — no auth; used before subscribe permission prompt.
  if (pathname === "/api/push/vapid-public-key") {
    return NextResponse.next();
  }

  // Vercel Cron jobs — authenticated inside each route via CRON_SECRET.
  if (pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Paystack webhooks — public POST; signature verified inside the route.
  if (pathname === "/api/webhooks/paystack") {
    return NextResponse.next();
  }

  // Product-sale Paystack callback — public thank-you / verify page for payers.
  if (pathname.startsWith("/pay/product-sale")) {
    return NextResponse.next();
  }

  // Public email/SMS unsubscribe links (no auth).
  if (
    pathname.startsWith("/unsubscribe") ||
    pathname.startsWith("/api/unsubscribe")
  ) {
    return NextResponse.next();
  }

  // Internal SMS short-link redirects (no auth; route 302s to destination).
  if (pathname.startsWith("/s/")) {
    return NextResponse.next();
  }

  // OAuth start/callback — public; flow validated via signed cookie in-route.
  if (
    pathname === "/auth/start" ||
    pathname === "/auth/callback" ||
    pathname === "/auth/error"
  ) {
    return NextResponse.next();
  }

  // Portal invite acceptance / landlord self-signup APIs — public; validate in-route.
  if (
    pathname === "/api/portal/accept-invite" ||
    pathname === "/api/landlord-portal/accept-invite" ||
    pathname === "/api/landlord-portal/signup" ||
    pathname === "/api/staff/accept-invite"
  ) {
    return NextResponse.next();
  }

  // Public rental application form (token in path); APIs validate hashed token.
  if (pathname.startsWith("/apply/") || pathname.startsWith("/api/apply/")) {
    return NextResponse.next();
  }

  // Maintenance mode — blocks all access except heartbeat and the maintenance page itself.
  if (process.env.MAINTENANCE_MODE === "true") {
    if (pathname === "/maintenance") {
      return NextResponse.next();
    }
    const url = request.nextUrl.clone();
    url.pathname = "/maintenance";
    return NextResponse.redirect(url);
  }

  const { supabase, response } = createClient(request);
  const perf = createPerfProbe();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  perf.countAuth();

  const isPortalPath = pathname.startsWith("/portal");
  const isLandlordPortalPath = pathname.startsWith("/landlord-portal");
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
    "/forgot-password",
    "/reset-password",
    "/verify-email",
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
    } else if (isPortalPath) {
      url.pathname = "/portal/login";
    } else {
      url.pathname = "/login";
    }
    // Preserve destination for staff login only (portals keep their own default).
    url.search = "";
    if (!isPortalPath && !isLandlordPortalPath) {
      const returnPath = `${pathname}${request.nextUrl.search}`;
      url.searchParams.set("next", returnPath);
    }
    return NextResponse.redirect(url);
  }

  const needsAccountGate =
    user &&
    pathname !== "/login" &&
    !isPortalPublicPath &&
    !isLandlordPortalPublicPath;

  const needsPersonaCheck =
    user &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/accept-invite" ||
      isPortalPublicPath ||
      isLandlordPortalPublicPath ||
      (isPortalPath && !isPortalPublicPath) ||
      (isLandlordPortalPath && !isLandlordPortalPublicPath) ||
      pathname.startsWith("/dashboard"));

  let accountRow: MiddlewareAccountRow | null = null;

  if (user && (needsAccountGate || needsPersonaCheck)) {
    const { data: account } = await supabase
      .from("user_accounts")
      .select("is_active, tenant_id, role, employee_id, client_id")
      .eq("auth_uid", user.id)
      .maybeSingle();
    perf.countDb();

    accountRow = account ?? null;

    if (needsAccountGate && accountRow?.is_active === false) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  let isLesseePortalUser = false;
  let isLandlordPortalUser = false;
  let resolvedPortal: "staff" | "lessee" | "landlord" = "staff";

  if (needsPersonaCheck) {
    const persona = await resolveMiddlewarePersona({
      supabase,
      user,
      pathname,
      accountRow,
    });
    isLesseePortalUser = persona.isLesseePortalUser;
    isLandlordPortalUser = persona.isLandlordPortalUser;
    resolvedPortal = persona.portal;
    if (persona.extraDbCalls > 0) {
      perf.countDb(persona.extraDbCalls);
    } else if (
      pathname.startsWith("/dashboard") &&
      accountRow &&
      !user.user_metadata?.portal
    ) {
      perf.countSkippedDb(2);
    } else if (user.user_metadata?.portal) {
      perf.countSkippedDb(2);
    }
  }

  // MFA gate — must run before persona routing and login → dashboard redirects.
  if (user && needsPersonaCheck) {
    const mfaRedirect = await getMfaChallengeRedirectPath({
      supabase,
      userId: user.id,
      pathname,
      searchParams: request.nextUrl.searchParams,
      isLesseePortalUser,
      isLandlordPortalUser,
    });
    if (mfaRedirect) {
      return redirectToRelativePath(request, mfaRedirect);
    }
  }

  // Authenticated lessees use /portal/*, not staff /dashboard or landlord portal.
  if (
    user &&
    isLesseePortalUser &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/accept-invite" ||
      pathname.startsWith("/dashboard") ||
      isLandlordPortalPath)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/dashboard";
    return NextResponse.redirect(url);
  }

  // Authenticated landlords use /landlord-portal/*, not staff /dashboard or tenant portal.
  if (
    user &&
    isLandlordPortalUser &&
    (pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/accept-invite" ||
      pathname.startsWith("/dashboard") ||
      isPortalPath)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/landlord-portal/dashboard";
    return NextResponse.redirect(url);
  }

  if (
    user &&
    !isLesseePortalUser &&
    !isLandlordPortalUser &&
    (pathname === "/login" || pathname === "/signup" || pathname === "/accept-invite")
  ) {
    const blockDashboardRedirect = await shouldBlockLoginAutoRedirect({
      supabase,
      userId: user.id,
      pathname,
      isLesseePortalUser,
      isLandlordPortalUser,
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

  if (user && isPortalPublicPath && isLesseePortalUser) {
    const blockRedirect = await shouldBlockLoginAutoRedirect({
      supabase,
      userId: user.id,
      pathname: "/portal/login",
      isLesseePortalUser,
      isLandlordPortalUser,
    });
    if (!blockRedirect) {
      const url = request.nextUrl.clone();
      url.pathname = "/portal/dashboard";
      return NextResponse.redirect(url);
    }
    const nextParam = request.nextUrl.searchParams.get("next");
    return redirectToRelativePath(
      request,
      `${MFA_CHALLENGE_ROUTES.lessee.challengePath}?next=${encodeURIComponent(getSafeNext(nextParam, "/portal/dashboard"))}`,
    );
  }

  if (user && isLandlordPortalPublicPath && isLandlordPortalUser) {
    const blockRedirect = await shouldBlockLoginAutoRedirect({
      supabase,
      userId: user.id,
      pathname: "/landlord-portal/login",
      isLesseePortalUser,
      isLandlordPortalUser,
    });
    if (!blockRedirect) {
      const url = request.nextUrl.clone();
      url.pathname = "/landlord-portal/dashboard";
      return NextResponse.redirect(url);
    }
    const nextParam = request.nextUrl.searchParams.get("next");
    return redirectToRelativePath(
      request,
      `${MFA_CHALLENGE_ROUTES.landlord.challengePath}?next=${encodeURIComponent(getSafeNext(nextParam, "/landlord-portal/dashboard"))}`,
    );
  }

  // Non-lessee sessions cannot use the tenant portal dashboard.
  if (user && isPortalPath && !isPortalPublicPath && !isLesseePortalUser) {
    const url = request.nextUrl.clone();
    url.pathname = isLandlordPortalUser
      ? "/landlord-portal/dashboard"
      : "/dashboard";
    return NextResponse.redirect(url);
  }

  // Non-landlord sessions cannot use the landlord portal dashboard.
  if (
    user &&
    isLandlordPortalPath &&
    !isLandlordPortalPublicPath &&
    !isLandlordPortalUser
  ) {
    const url = request.nextUrl.clone();
    url.pathname = isLesseePortalUser ? "/portal/dashboard" : "/dashboard";
    return NextResponse.redirect(url);
  }

  // Trial / suspension enforcement runs in app/dashboard/layout.tsx only — not on
  // /trial-expired, /account-suspended, /login, /signup, or /api/signup.

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  if (
    user &&
    accountRow &&
    accountRow.is_active !== false &&
    (pathname.startsWith("/dashboard") ||
      (isPerfProbeEnabled() &&
        pathname === "/api/perf-probe/trusted-context"))
  ) {
    const signed = await signAuthContext({
      authUid: user.id,
      tenantId: accountRow.tenant_id,
      role: accountRow.role,
      employeeId: accountRow.employee_id,
      clientId: accountRow.client_id,
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

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") {
      nextResponse.headers.set(key, value);
    }
  });

  nextResponse.headers.set(
    "Cache-Control",
    "private, no-store, no-cache, must-revalidate",
  );

  if (isPerfProbeEnabled()) {
    for (const [key, value] of Object.entries(perf.toHeaderValues())) {
      nextResponse.headers.set(key, value);
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
      }),
    );
  }

  return nextResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
