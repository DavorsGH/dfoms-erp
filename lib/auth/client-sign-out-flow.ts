"use client";

import { purgeClientCacheBeforeSignOut } from "@/lib/client-cache/client-sign-out";

export type PlatformSignOutLoginPath =
  | "/login"
  | "/portal/login"
  | "/landlord-portal/login"
  | "/facility-portal/login";

/** POST sign-out, background cache purge, then hard navigation to persona login. */
export async function executeClientPlatformSignOut(
  loginPath: PlatformSignOutLoginPath,
): Promise<void> {
  const response = await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error("Sign out request failed.");
  }

  void purgeClientCacheBeforeSignOut().catch((error) => {
    console.error("[sign-out] client cache purge failed:", error);
  });

  window.location.assign(loginPath);
}
