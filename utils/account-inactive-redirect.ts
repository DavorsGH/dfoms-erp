import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { clearSupabaseAuthCookiesOnStore } from "@/lib/auth/clear-supabase-auth-cookies";
import {
  ACCOUNT_INACTIVE_NOTICE,
  ACCOUNT_NO_LONGER_ACTIVE_MESSAGE,
  accountInactiveLoginPath,
} from "@/lib/auth/account-inactive-message";

export {
  ACCOUNT_INACTIVE_NOTICE,
  ACCOUNT_NO_LONGER_ACTIVE_MESSAGE,
  accountInactiveLoginPath,
};

/**
 * When a protected portal/staff page cannot resolve an active persona row,
 * clear Auth cookies directly (signOut is best-effort only) and send the user
 * to login with a clear notice — never throw a raw workspace error.
 */
export async function redirectInactiveOrSignedOut(
  loginPath: string,
): Promise<never> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // Banned/deleted Auth users — ignore; cookies cleared below.
    }
  }

  clearSupabaseAuthCookiesOnStore(cookieStore);
  redirect(
    user ? accountInactiveLoginPath(loginPath) : loginPath,
  );
}

export function noticeMessageFromSearchParam(
  notice: string | null | undefined,
): string | null {
  if (notice === ACCOUNT_INACTIVE_NOTICE) {
    return ACCOUNT_NO_LONGER_ACTIVE_MESSAGE;
  }
  return null;
}
