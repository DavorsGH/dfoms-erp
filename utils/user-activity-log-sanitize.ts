const SENSITIVE_METADATA_KEYS =
  /password|otp|code|secret|token|refresh|access_token/i;

/** Strip keys that must never be persisted in activity metadata. */
export function sanitizeActivityMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!metadata) {
    return null;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.test(key)) {
      continue;
    }
    cleaned[key] = value;
  }

  return Object.keys(cleaned).length > 0 ? cleaned : null;
}
