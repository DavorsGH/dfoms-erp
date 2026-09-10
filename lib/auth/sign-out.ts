"use server";

import { cookies } from "next/headers";
import {
  AUTH_PERSIST_FLAG_COOKIE,
  authPersistFlagCookieOptions,
} from "@/lib/auth/session-persistence";
import { runPlatformSignOut } from "@/lib/auth/platform-sign-out-core";

/** Clear persist flag and Supabase session — use from all sign-out buttons. */
export async function completePlatformSignOut(): Promise<void> {
  await runPlatformSignOut();
}

/** Set stay-logged-in preference before password sign-in completes. */
export async function setAuthPersistPreference(stayLoggedIn: boolean): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    AUTH_PERSIST_FLAG_COOKIE,
    stayLoggedIn ? "1" : "0",
    authPersistFlagCookieOptions(stayLoggedIn),
  );
}
