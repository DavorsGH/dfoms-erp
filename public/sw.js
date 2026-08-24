const CACHE_NAME = "davors-erp-shell-v10";
const CLIENT_CACHE_DB_NAME = "dfoms-client-cache";
const CLIENT_CACHE_PURGE_MESSAGE = "PURGE_CLIENT_CACHE";
const WARM_OFFLINE_NAV_MESSAGE = "WARM_OFFLINE_NAV_ROUTES";
const OFFLINE_URL = "/offline";

/** Public assets always cached at install (no auth). */
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.json",
  "/favicon.ico",
  "/logo.jpg",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
  "/icons/icon-maskable-192x192.png",
  "/icons/icon-maskable-512x512.png",
  "/icons/apple-touch-icon-180x180.png",
];

/**
 * Authenticated app shells warmed after login (credentials included).
 * Install-time precache cannot fetch these (no session cookies).
 */
const OFFLINE_NAV_ROUTES = [
  "/dashboard",
  "/dashboard/hr-payroll/attendance",
  "/dashboard/finance/expenses",
  "/dashboard/pos",
];

function isOfflineNavRoute(pathname) {
  return OFFLINE_NAV_ROUTES.some(
    (route) => pathname === route || pathname === `${route}/`,
  );
}

function isCacheableStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/__offline_assets/") ||
    pathname === "/manifest.json" ||
    pathname === "/favicon.ico" ||
    pathname === "/logo.jpg" ||
    pathname === OFFLINE_URL ||
    /^\/favicon-\d+x\d+\.png$/.test(pathname) ||
    /^\/apple-touch-icon.*\.png$/.test(pathname)
  );
}

function extractSameOriginAssetUrls(html, origin) {
  const urls = new Set();
  const patterns = [
    /(?:src|href)=["']([^"']+)["']/gi,
    /["'](\/_next\/static\/[^"']+)["']/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null) {
      try {
        const absolute = new URL(match[1], origin);
        if (
          absolute.origin === origin &&
          isCacheableStaticAsset(absolute.pathname)
        ) {
          urls.add(absolute.href);
        }
      } catch {
        // ignore malformed
      }
    }
  }
  return [...urls];
}

async function cacheUrl(cache, url, init) {
  try {
    const response = await fetch(url, init);
    if (!response || !response.ok) {
      return false;
    }
    await cache.put(url, response.clone());
    return true;
  } catch {
    return false;
  }
}

async function matchCachedNavigation(cache, request, pathname) {
  const absolute = new URL(pathname, self.location.origin).href;
  const matchOpts = { ignoreSearch: true, ignoreVary: true };
  return (
    (await cache.match(request, matchOpts)) ||
    (await cache.match(absolute, matchOpts)) ||
    (await cache.match(pathname, matchOpts))
  );
}

async function putNavigationCache(cache, pathname, response) {
  const absolute = new URL(pathname, self.location.origin).href;
  const request = new Request(absolute, {
    method: "GET",
    credentials: "include",
  });
  await cache.put(request, response.clone());
}

async function warmOfflineNavRoutes() {
  const cache = await caches.open(CACHE_NAME);
  const origin = self.location.origin;

  for (const route of OFFLINE_NAV_ROUTES) {
    const absolute = new URL(route, origin).href;
    const response = await fetch(absolute, {
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
    }).catch(() => null);

    if (!response || !response.ok) {
      continue;
    }

    const contentType = response.headers.get("content-type") || "";
    await putNavigationCache(cache, route, response);

    if (contentType.includes("text/html")) {
      const html = await response.clone().text();
      const assetUrls = extractSameOriginAssetUrls(html, origin);
      await Promise.all(
        assetUrls.map((assetUrl) =>
          cacheUrl(cache, assetUrl, { credentials: "same-origin" }),
        ),
      );
    }
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(event.request);
          if (response && response.ok && isOfflineNavRoute(url.pathname)) {
            const cache = await caches.open(CACHE_NAME);
            await putNavigationCache(cache, url.pathname, response);
          }
          return response;
        } catch {
          try {
            const cache = await caches.open(CACHE_NAME);
            const exact = await matchCachedNavigation(
              cache,
              event.request,
              url.pathname,
            );
            if (exact) {
              return exact;
            }
            const offline = await cache.match(OFFLINE_URL, {
              ignoreSearch: true,
              ignoreVary: true,
            });
            if (offline) {
              return offline;
            }
          } catch {
            // fall through
          }
          return new Response(
            "<!DOCTYPE html><html><body><h1>Offline</h1><p>Reconnect to continue.</p></body></html>",
            {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            },
          );
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return;
  }

  if (!isCacheableStaticAsset(url.pathname)) {
    return;
  }

  // Offline avatar/logo assets: cache-only. Never network-fetch on miss —
  // Next would return HTML 404 that could be cached as the "image".
  if (url.pathname.startsWith("/__offline_assets/")) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) {
          return cached;
        }
        return new Response("", { status: 404 });
      }),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) {
        return cached;
      }

      // Never leave cache-miss fetches pending forever when offline — that
      // breaks React hydration (POS Add to Cart clicks appear to do nothing).
      try {
        const response = await fetch(event.request, {
          signal: AbortSignal.timeout(8000),
        });
        if (!response || response.status !== 200 || response.type === "opaque") {
          return response;
        }
        const copy = response.clone();
        const cache = await caches.open(CACHE_NAME);
        await cache.put(event.request, copy);
        return response;
      } catch {
        return new Response("Offline cache miss", {
          status: 504,
          statusText: "Offline cache miss",
        });
      }
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Davors ERP",
    body: "You have a new notification.",
    url: "/",
    tag: "dfoms-notification",
    notificationId: null,
  };

  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch {
    // Keep defaults when payload is malformed.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-192x192.png",
      tag: payload.tag || payload.notificationId || "dfoms-notification",
      data: {
        url: payload.url || "/",
        notificationId: payload.notificationId,
      },
      silent: false,
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client && client.url.startsWith(self.location.origin)) {
            if ("navigate" in client && typeof client.navigate === "function") {
              return client.focus().then(() => client.navigate(targetUrl));
            }
            return client.focus();
          }
        }

        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }

        return undefined;
      }),
  );
});

self.addEventListener("message", (event) => {
  if (!event.data || typeof event.data.type !== "string") {
    return;
  }

  if (event.data.type === CLIENT_CACHE_PURGE_MESSAGE) {
    event.waitUntil(
      new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(CLIENT_CACHE_DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () =>
          reject(request.error ?? new Error("IndexedDB purge failed"));
        request.onblocked = () => resolve();
      }),
    );
    return;
  }

  if (event.data.type === WARM_OFFLINE_NAV_MESSAGE) {
    event.waitUntil(warmOfflineNavRoutes());
  }
});
