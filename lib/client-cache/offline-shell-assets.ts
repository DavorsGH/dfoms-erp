"use client";

import {
  OFFLINE_ASSET_USER_AVATAR_PATH,
  OFFLINE_ASSET_WORKSPACE_LOGO_PATH,
  SHELL_CACHE_NAME,
} from "@/lib/client-cache/constants";

export const OFFLINE_WORKSPACE_LOGO_PATH = OFFLINE_ASSET_WORKSPACE_LOGO_PATH;
export const OFFLINE_USER_AVATAR_PATH = OFFLINE_ASSET_USER_AVATAR_PATH;

async function putSameOriginAsset(
  cacheKeyPath: string,
  sourceUrl: string,
): Promise<boolean> {
  if (typeof window === "undefined" || !("caches" in window)) {
    return false;
  }
  const trimmed = sourceUrl.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const response = await fetch(trimmed, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
    });
    if (!response.ok) {
      const retry = await fetch(trimmed, {
        mode: "cors",
        credentials: "include",
        cache: "no-store",
      });
      if (!retry.ok) {
        return false;
      }
      const cache = await caches.open(SHELL_CACHE_NAME);
      const absolute = new URL(cacheKeyPath, window.location.origin).href;
      await cache.put(absolute, retry.clone());
      return true;
    }

    const cache = await caches.open(SHELL_CACHE_NAME);
    const absolute = new URL(cacheKeyPath, window.location.origin).href;
    await cache.put(absolute, response.clone());
    return true;
  } catch {
    return false;
  }
}

/**
 * Warm same-origin Cache API entries for remote navbar images so offline
 * pages can load them via `/__offline_assets/...` (SW-controlled).
 */
export async function warmOfflineShellImageAssets(input: {
  avatarUrl?: string | null;
  workspaceLogoUrl?: string | null;
}): Promise<void> {
  const tasks: Promise<boolean>[] = [];

  if (input.avatarUrl?.trim().startsWith("http")) {
    tasks.push(
      putSameOriginAsset(OFFLINE_ASSET_USER_AVATAR_PATH, input.avatarUrl),
    );
  }

  const logo = input.workspaceLogoUrl?.trim() ?? "";
  if (logo.startsWith("http")) {
    tasks.push(putSameOriginAsset(OFFLINE_ASSET_WORKSPACE_LOGO_PATH, logo));
  } else if (logo.startsWith("/")) {
    tasks.push(
      putSameOriginAsset(logo, new URL(logo, window.location.origin).href),
    );
  }

  await Promise.all(tasks);
}

/**
 * Resolve avatar URL for display.
 * Online → remote (or same-origin) photo URL.
 * Offline path (`/__offline_assets/...`) is used only when !isOnline and the
 * source is a remote http(s) URL that was warmed into the shell cache.
 */
export function offlineAvatarSrc(
  isOnline: boolean,
  photoUrl?: string | null,
): string | undefined {
  const trimmed = photoUrl?.trim() ?? "";
  if (!trimmed) {
    return undefined;
  }
  if (isOnline || !trimmed.startsWith("http")) {
    return trimmed;
  }
  return OFFLINE_ASSET_USER_AVATAR_PATH;
}

export function offlineWorkspaceLogoSrc(
  isOnline: boolean,
  workspaceLogoUrl: string,
): string {
  const trimmed = workspaceLogoUrl.trim();
  if (!trimmed) {
    return "/logo.jpg";
  }
  if (isOnline || !trimmed.startsWith("http")) {
    return trimmed;
  }
  return OFFLINE_ASSET_WORKSPACE_LOGO_PATH;
}
