import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/middleware";

export async function middleware(request: NextRequest) {
  const { supabase, response } = createClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  // External cron keepalive — must stay reachable without a session.
  if (pathname === "/api/heartbeat") {
    return response;
  }

  const publicPaths = new Set(["/login", "/signup", "/api/signup"]);
  if (!user && !publicPaths.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname !== "/login") {
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

  if (user && (pathname === "/" || pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // Trial enforcement runs in app/dashboard/layout.tsx only — not on
  // /trial-expired, /login, /signup, or /api/signup (avoids redirect loops).

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
