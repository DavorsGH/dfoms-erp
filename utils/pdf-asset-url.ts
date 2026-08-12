import "server-only";

/**
 * Resolve logo/signature paths for server-side @react-pdf Image fetches.
 * Signed Supabase URLs pass through unchanged; relative public paths become absolute.
 */
export function resolvePdfAssetUrl(
  url: string | null | undefined,
  siteBaseUrl?: string | null,
): string | null {
  const trimmed = url?.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  const base =
    siteBaseUrl?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com";

  const normalizedBase = base.replace(/\/$/, "");
  if (trimmed.startsWith("/")) {
    return `${normalizedBase}${trimmed}`;
  }

  return `${normalizedBase}/${trimmed}`;
}
