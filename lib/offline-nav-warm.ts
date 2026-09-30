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

const ROUTE_WARM_IFRAME_TIMEOUT_MS = 20_000;
const ROUTE_WARM_START_DELAY_MS = 20_000;

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
export type RequestOfflineRouteWarmOptions = {
  currentPathname?: string;
};

export async function requestOfflineRouteWarm(
  options: RequestOfflineRouteWarmOptions = {},
): Promise<void> {
  if (typeof navigator.onLine === "boolean" && !navigator.onLine) {
    return;
  }

  await postWarmOfflineNavMessage();

  const current = normalizeWarmPath(options.currentPathname);
  const routes = OFFLINE_NAV_ROUTES.filter(
    (route) => normalizeWarmPath(route) !== current,
  );

  await warmRoutesViaHiddenIframesSequential(routes);
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
  currentPathname?: string;
}): Promise<void> {
  await Promise.all([
    requestOfflineRouteWarm({ currentPathname: options?.currentPathname }),
    requestOfflineShellImageWarm(options),
  ]);
}

function normalizeWarmPath(pathname?: string | null): string {
  if (!pathname?.trim()) {
    return "";
  }
  const path = pathname.trim();
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function warmRoutesViaHiddenIframesSequential(routes: string[]): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let routeIndex = 0;
    let paused = document.hidden;
    let visibilityResumeTimer: undefined | number;

    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (visibilityResumeTimer !== undefined) {
        window.clearTimeout(visibilityResumeTimer);
      }
    };

    const warmNext = () => {
      if (routeIndex >= routes.length) {
        cleanup();
        resolve();
        return;
      }
      if (paused) {
        return;
      }

      const route = routes[routeIndex];
      routeIndex += 1;

      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.cssText =
        "position:absolute;width:0;height:0;border:0;visibility:hidden";
      iframe.src = route;

      let settled = false;
      const finishOne = () => {
        if (settled) {
          return;
        }
        settled = true;
        iframe.onload = null;
        iframe.onerror = null;
        iframe.remove();
        warmNext();
      };

      iframe.onload = finishOne;
      iframe.onerror = finishOne;
      window.setTimeout(finishOne, ROUTE_WARM_IFRAME_TIMEOUT_MS);
      document.body.appendChild(iframe);
    };

    const onVisibilityChange = () => {
      paused = document.hidden;
      if (paused) {
        return;
      }
      if (visibilityResumeTimer !== undefined) {
        window.clearTimeout(visibilityResumeTimer);
      }
      visibilityResumeTimer = window.setTimeout(warmNext, 300);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    warmNext();
  });
}

export function scheduleOfflineRouteWarm(
  options: RequestOfflineRouteWarmOptions & { onWarmFinished?: () => void } = {},
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  let cancelled = false;
  let delayTimer: undefined | number;
  let idleId: number | undefined;

  const startDelayedWarm = () => {
    if (cancelled) {
      return;
    }
    delayTimer = window.setTimeout(() => {
      if (!cancelled) {
        void requestOfflineRouteWarm(options).finally(() => {
          options.onWarmFinished?.();
        });
      }
    }, ROUTE_WARM_START_DELAY_MS);
  };

  const onLoad = () => {
    if (cancelled) {
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(startDelayedWarm, { timeout: 5000 });
    } else {
      delayTimer = window.setTimeout(startDelayedWarm, 500);
    }
  };

  if (document.readyState === "complete") {
    onLoad();
  } else {
    window.addEventListener("load", onLoad, { once: true });
  }

  return () => {
    cancelled = true;
    window.removeEventListener("load", onLoad);
    if (delayTimer !== undefined) {
      window.clearTimeout(delayTimer);
    }
    if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
    }
  };
}
