"use client";

import { warmOfflineShellImageAssets } from "@/lib/client-cache/offline-shell-assets";

export const WARM_OFFLINE_NAV_MESSAGE = "WARM_OFFLINE_NAV_ROUTES" as const;

/** sessionStorage key prefix — value is sessionKey (tenantId:authUid). */
export const OFFLINE_ROUTE_WARM_STORAGE_PREFIX = "dfoms-offline-route-warm";

/** Routes guaranteed for offline hard-navigation after a successful warm. */
export const OFFLINE_NAV_ROUTES = [
  "/dashboard",
  "/dashboard/hr-payroll/attendance",
  "/dashboard/finance/expenses",
  "/dashboard/pos",
] as const;

export function buildOfflineWarmSessionKey(
  tenantId: string,
  authUid: string,
): string {
  return `${tenantId}:${authUid}`;
}

export function hasOfflineRouteWarmCompleted(sessionKey: string): boolean {
  if (typeof sessionStorage === "undefined") {
    return false;
  }
  try {
    return (
      sessionStorage.getItem(`${OFFLINE_ROUTE_WARM_STORAGE_PREFIX}:${sessionKey}`) ===
      "1"
    );
  } catch {
    return false;
  }
}

export function markOfflineRouteWarmCompleted(sessionKey: string): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(
      `${OFFLINE_ROUTE_WARM_STORAGE_PREFIX}:${sessionKey}`,
      "1",
    );
  } catch {
    // Non-fatal (private browsing quota, etc.)
  }
}

/** Strip signed-URL query tokens so avatar warm deps stay stable across layout refetches. */
export function stableAvatarWarmKey(avatarUrl?: string | null): string {
  const trimmed = avatarUrl?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed, window.location.origin);
    return `${url.origin}${url.pathname}`;
  } catch {
    return trimmed.split("?")[0] ?? trimmed;
  }
}

async function postWarmOfflineNavMessage(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
    return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    const worker =
      registration.active ?? registration.waiting ?? registration.installing;
    worker?.postMessage({ type: WARM_OFFLINE_NAV_MESSAGE });
  } catch {
    // Non-fatal
  }
}

/**
 * Warm authenticated HTML shells + JS chunks (SW message + hidden iframes).
 * Idempotent per browser tab session when sessionKey gate is used by the caller.
 */
export async function requestOfflineRouteWarm(): Promise<void> {
  if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
    return;
  }

  await postWarmOfflineNavMessage();
  await warmRoutesViaHiddenIframes([...OFFLINE_NAV_ROUTES]);
}

/** Warm remote avatar/logo into same-origin Cache API entries for offline display. */
export async function requestOfflineShellImageWarm(options?: {
  avatarUrl?: string | null;
  workspaceLogoUrl?: string | null;
}): Promise<void> {
  if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
    return;
  }

  await warmOfflineShellImageAssets({
    avatarUrl: options?.avatarUrl,
    workspaceLogoUrl: options?.workspaceLogoUrl,
  });
}

/**
 * @deprecated Prefer separate route + image warm with session gating in DashboardShell.
 */
export async function requestOfflineNavWarm(options?: {
  avatarUrl?: string | null;
  workspaceLogoUrl?: string | null;
}): Promise<void> {
  await Promise.all([
    requestOfflineRouteWarm(),
    requestOfflineShellImageWarm(options),
  ]);
}

function warmRoutesViaHiddenIframes(routes: string[]): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let remaining = routes.length;
    if (remaining === 0) {
      resolve();
      return;
    }

    const done = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
      }
    };

    for (const route of routes) {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.cssText =
        "position:absolute;width:0;height:0;border:0;visibility:hidden";
      iframe.src = route;

      const finish = () => {
        iframe.onload = null;
        iframe.onerror = null;
        iframe.remove();
        done();
      };

      iframe.onload = finish;
      iframe.onerror = finish;
      window.setTimeout(finish, 20000);
      document.body.appendChild(iframe);
    }
  });
}
