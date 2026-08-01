import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

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

  // Tenant portal invite acceptance API — public; validates token in-route.
  if (pathname === "/api/portal/accept-invite") {
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
  const isPortalPublicPath =
    pathname === "/portal/login" || pathname === "/portal/accept-invite";

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
  ]);

  if (
    !user &&
    !publicPaths.has(pathname) &&
    !pathname.startsWith("/pay/product-sale") &&
    !pathname.startsWith("/unsubscribe") &&
    !pathname.startsWith("/api/unsubscribe") &&
    !pathname.startsWith("/api/cron/")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = isPortalPath ? "/portal/login" : "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname !== "/login" && !isPortalPublicPath) {
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
  if (
    user &&
    (pathname === "/" ||
      pathname === "/login" ||
      pathname === "/signup" ||
      isPortalPublicPath ||
      (isPortalPath && !isPortalPublicPath))
  ) {
    // Prefer auth metadata stamped at invite accept; fall back to lessees row.
    if (user.user_metadata?.portal === "lessee") {
      isLesseePortalUser = true;
    } else {
      const { data: lessee } = await supabase
        .from("lessees")
        .select("lessee_id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      isLesseePortalUser = Boolean(lessee);
    }
  }

  // Authenticated lessees use /portal/*, not staff /dashboard.
  if (
    user &&
    isLesseePortalUser &&
    (pathname === "/" ||
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname.startsWith("/dashboard"))
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

  if (
    user &&
    !isLesseePortalUser &&
    (pathname === "/" || pathname === "/login" || pathname === "/signup")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Non-lessee sessions cannot use the tenant portal dashboard.
  if (user && isPortalPath && !isPortalPublicPath && !isLesseePortalUser) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
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
