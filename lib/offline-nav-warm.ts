"use client";

export const WARM_OFFLINE_NAV_MESSAGE = "WARM_OFFLINE_NAV_ROUTES" as const;

/** Routes guaranteed for offline hard-navigation after a successful warm. */
export const OFFLINE_NAV_ROUTES = [
  "/dashboard",
  "/dashboard/hr-payroll/attendance",
  "/dashboard/finance/expenses",
] as const;

/**
 * Ask the service worker to cache authenticated HTML shells, then load each
 * route in a hidden iframe so /_next/static chunks are also cached via the SW
 * static-asset handler (HTML alone is not enough for App Router pages).
 */
export async function requestOfflineNavWarm(): Promise<void> {
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

  await warmRoutesViaHiddenIframes([...OFFLINE_NAV_ROUTES]);
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
      // Safety timeout — don't block the app if a route hangs.
      window.setTimeout(finish, 20000);
      document.body.appendChild(iframe);
    }
  });
}
