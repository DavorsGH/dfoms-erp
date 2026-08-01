/**
 * Same-origin relative path checks for post-login / middleware redirects.
 * Blocks open redirects (absolute URLs, protocol-relative, scheme smuggling).
 */

export function isSafeRelativePath(
  value: string | null | undefined,
): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return false;
  // Protocol-relative: //evil.example
  if (trimmed.startsWith("//")) return false;
  // Scheme smuggling: /\\evil, javascript:, http:, etc. on the path string
  if (trimmed.includes("\\")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  return true;
}

/**
 * Returns a validated relative path+query, or `fallback` when unsafe/missing.
 */
export function getSafeNext(
  value: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!isSafeRelativePath(value)) return fallback;
  return value.trim();
}
