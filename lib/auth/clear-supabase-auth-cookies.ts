import type { NextRequest, NextResponse } from "next/server";
import {
  AUTH_PERSIST_FLAG_COOKIE,
  authPersistFlagCookieOptions,
  isSupabaseAuthTokenCookie,
} from "@/lib/auth/session-persistence";

/** Expire auth cookies on a middleware/proxy redirect response. */
export function clearSupabaseAuthCookiesOnResponse(
  request: NextRequest,
  response: NextResponse,
): void {
  const expire = {
    path: "/",
    maxAge: 0,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  for (const { name } of request.cookies.getAll()) {
    if (isSupabaseAuthTokenCookie(name)) {
      response.cookies.set(name, "", expire);
    }
  }

  response.cookies.set(AUTH_PERSIST_FLAG_COOKIE, "", {
    ...authPersistFlagCookieOptions(false),
    maxAge: 0,
  });
}

type CookieStoreLike = {
  getAll: () => { name: string; value: string }[];
  set: (
    name: string,
    value: string,
    options?: Record<string, unknown>,
  ) => void;
};

/** Expire auth cookies via Next.js cookies() (Server Actions / RSC redirects). */
export function clearSupabaseAuthCookiesOnStore(cookieStore: CookieStoreLike): void {
  const expire = {
    path: "/",
    maxAge: 0,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  for (const { name } of cookieStore.getAll()) {
    if (isSupabaseAuthTokenCookie(name)) {
      cookieStore.set(name, "", expire);
    }
  }

  cookieStore.set(AUTH_PERSIST_FLAG_COOKIE, "", {
    ...authPersistFlagCookieOptions(false),
    maxAge: 0,
  });
}
