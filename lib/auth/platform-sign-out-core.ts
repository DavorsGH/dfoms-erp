import "server-only";

import { cookies } from "next/headers";
import {
  AUTH_PERSIST_FLAG_COOKIE,
  authPersistFlagCookieOptions,
} from "@/lib/auth/session-persistence";
import { invalidateMfaGateCache } from "@/lib/mfa/middleware-gate-cache";
import { createClient } from "@/utils/supabase/server";

/** Clear persist flag and Supabase session (server-side). */
export async function runPlatformSignOut(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_PERSIST_FLAG_COOKIE, "", {
    ...authPersistFlagCookieOptions(false),
    maxAge: 0,
  });

  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    invalidateMfaGateCache(user.id);
  }
  await supabase.auth.signOut();
}
