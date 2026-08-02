import { type NextRequest, NextResponse } from "next/server";
import { getSafeNext } from "@/utils/safe-redirect";
import { createClient } from "@/utils/supabase/middleware";

/** Redirect to a validated relative path+query (pathname + search). */
function redirectToRelativePath(request: NextRequest, relativePath: string) {
  const target = new URL(relativePath, request.nextUrl.origin);
  const url = request.nextUrl.clone();
  url.pathname = target.pathname;
  url.search = target.search;
  url.hash = "";
  return NextResponse.redirect(url);
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // External cron keepalive — must stay reachable without a session.
  if (pathname === "/api/heartbeat") {
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

  // Portal invite acceptance / landlord self-signup APIs — public; validate in-route.
  if (
    pathname === "/api/portal/accept-invite" ||
    pathname === "/api/landlord-portal/accept-invite" ||
    pathname === "/api/landlord-portal/signup"
  ) {
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isPortalPath = pathname.startsWith("/portal");
  const isLandlordPortalPath = pathname.startsWith("/landlord-portal");
  const isPortalPublicPath =
    pathname === "/portal/login" || pathname === "/portal/accept-invite";
  const isLandlordPortalPublicPath =
    pathname === "/landlord-portal/login" ||
    pathname === "/landlord-portal/accept-invite" ||
    pathname === "/landlord-portal/signup";

  const publicPaths = new Set([
    "/",
    "/login",
    "/signup",
    "/api/signup",
    "/api/webhooks/paystack",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/portal/login",
    "/portal/accept-invite",
    "/landlord-portal/login",
    "/landlord-portal/accept-invite",
    "/landlord-portal/signup",
    "/api/landlord-portal/signup",
  ]);

  if (
    !user &&
    !publicPaths.has(pathname) &&
    !pathname.startsWith("/pay/product-sale") &&
    !pathname.startsWith("/unsubscribe") &&
    !pathname.startsWith("/api/unsubscribe") &&
    !pathname.startsWith("/s/") &&
    !pathname.startsWith("/api/cron/")
  ) {
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

  if (
    user &&
    pathname !== "/login" &&
    !isPortalPublicPath &&
    !isLandlordPortalPublicPath
  ) {
    const { data: account } = await supabase
      .from("user_accounts")
      .select("is_active")
      .eq("auth_uid", user.id)
      .maybeSingle();

    if (account?.is_active === false) {
      await supabase.auth.signOut();
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  let isLesseePortalUser = false;
  let isLandlordPortalUser = false;

  const needsPersonaCheck =
    user &&
    (pathname === "/" ||
      pathname === "/login" ||
      pathname === "/signup" ||
      isPortalPublicPath ||
      isLandlordPortalPublicPath ||
      (isPortalPath && !isPortalPublicPath) ||
      (isLandlordPortalPath && !isLandlordPortalPublicPath) ||
      pathname.startsWith("/dashboard"));

  if (needsPersonaCheck) {
    const portalMeta = user.user_metadata?.portal;
    if (portalMeta === "lessee") {
      isLesseePortalUser = true;
    } else if (portalMeta === "landlord") {
      isLandlordPortalUser = true;
    } else {
      const [{ data: lessee }, { data: landlord }] = await Promise.all([
        supabase
          .from("lessees")
          .select("lessee_id")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
        supabase
          .from("landlords")
          .select("tenant_id")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
      ]);
      isLesseePortalUser = Boolean(lessee);
      isLandlordPortalUser = Boolean(landlord);
    }
  }

  // Authenticated lessees use /portal/*, not staff /dashboard or landlord portal.
  if (
    user &&
    isLesseePortalUser &&
    (pathname === "/" ||
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/dashboard") ||
      isLandlordPortalPath)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/dashboard";
    return NextResponse.redirect(url);
  }

  if (user && isPortalPublicPath && isLesseePortalUser) {
    const url = request.nextUrl.clone();
    url.pathname = "/portal/dashboard";
    return NextResponse.redirect(url);
  }

  // Authenticated landlords use /landlord-portal/*, not staff /dashboard or tenant portal.
  if (
    user &&
    isLandlordPortalUser &&
    (pathname === "/" ||
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/dashboard") ||
      isPortalPath)
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/landlord-portal/dashboard";
    return NextResponse.redirect(url);
  }

  if (user && isLandlordPortalPublicPath && isLandlordPortalUser) {
    const url = request.nextUrl.clone();
    url.pathname = "/landlord-portal/dashboard";
    return NextResponse.redirect(url);
  }

  if (
    user &&
    !isLesseePortalUser &&
    !isLandlordPortalUser &&
    (pathname === "/" || pathname === "/login" || pathname === "/signup")
  ) {
    const nextParam =
      pathname === "/login"
        ? request.nextUrl.searchParams.get("next")
        : null;
    return redirectToRelativePath(
      request,
      getSafeNext(nextParam, "/dashboard"),
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

  response.headers.set("Cache-Control", "private, no-store, no-cache, must-revalidate");

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
