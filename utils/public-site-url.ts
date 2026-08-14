/** Canonical public portal origin for links embedded in SMS, email, and short URLs. */
export const PRODUCTION_PORTAL_SITE_URL = "https://portal.davorsfacilities.com";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

/** True when the URL/host points at local dev (localhost / 127.0.0.1). */
export function isLocalhostSiteUrl(urlOrHost: string): boolean {
  const trimmed = urlOrHost.trim();
  if (!trimmed) {
    return false;
  }

  try {
    const withScheme = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const hostname = new URL(withScheme).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(trimmed);
  }
}

/**
 * Resolve the site origin for customer-facing links.
 * In production, never returns localhost even if NEXT_PUBLIC_SITE_URL is mis-set.
 */
export function resolvePublicSiteUrl(): string {
  const configured = trimTrailingSlash(
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "",
  );

  if (configured) {
    if (isLocalhostSiteUrl(configured) && process.env.NODE_ENV === "production") {
      return PRODUCTION_PORTAL_SITE_URL;
    }
    return configured;
  }

  const vercelHost = process.env.VERCEL_URL?.trim();
  if (vercelHost && !isLocalhostSiteUrl(vercelHost)) {
    return `https://${vercelHost.replace(/\/$/, "")}`;
  }

  return PRODUCTION_PORTAL_SITE_URL;
}

/**
 * Request-aware site URL for Paystack callbacks and payment links.
 * Prefers configured/public URL; falls back to forwarded host; never localhost in production.
 */
export function resolveSiteUrlFromRequest(request: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? "";
  if (configured) {
    const normalized = trimTrailingSlash(configured);
    if (!(isLocalhostSiteUrl(normalized) && process.env.NODE_ENV === "production")) {
      return normalized;
    }
  }

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  if (host && !isLocalhostSiteUrl(host)) {
    return `${proto}://${host.split(",")[0]?.trim() ?? host}`;
  }

  if (process.env.NODE_ENV === "production") {
    return resolvePublicSiteUrl();
  }

  return "http://localhost:3000";
}
