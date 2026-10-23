import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";

/** Paginate every Auth user page until exhausted — never stop at page 1. */
export async function findAuthUserIdByEmailAcrossAllPages(
  admin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) {
      break;
    }
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === normalized,
    );
    if (match) {
      return match.id;
    }
    if (data.users.length < 200) {
      break;
    }
  }

  return null;
}

export async function loadAuthUserSnapshot(
  admin: SupabaseClient,
  authUserId: string | null,
): Promise<{
  exists: boolean;
  email: string | null;
  lastSignInAt: string | null;
  isSuspended: boolean;
  appMetadata: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
}> {
  if (!authUserId) {
    return {
      exists: false,
      email: null,
      lastSignInAt: null,
      isSuspended: false,
      appMetadata: {},
      userMetadata: {},
    };
  }

  const { data, error } = await admin.auth.admin.getUserById(authUserId);
  if (error || !data?.user) {
    return {
      exists: false,
      email: null,
      lastSignInAt: null,
      isSuspended: false,
      appMetadata: {},
      userMetadata: {},
    };
  }

  const user = data.user;
  const bannedUntil =
    (user as { banned_until?: string | null }).banned_until ?? null;

  return {
    exists: true,
    email: user.email?.trim().toLowerCase() ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    isSuspended: isAuthUserBanned(bannedUntil),
    appMetadata:
      user.app_metadata && typeof user.app_metadata === "object"
        ? (user.app_metadata as Record<string, unknown>)
        : {},
    userMetadata:
      user.user_metadata && typeof user.user_metadata === "object"
        ? (user.user_metadata as Record<string, unknown>)
        : {},
  };
}

export function isValidEmailFormat(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
