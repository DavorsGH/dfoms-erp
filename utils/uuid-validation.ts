const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

export function parseRequiredUuid(
  value: string | undefined | null,
  fieldName: string,
): { ok: true; value: string } | { ok: false; message: string } {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return { ok: false, message: `${fieldName} is required` };
  }

  if (!isValidUuid(trimmed)) {
    return {
      ok: false,
      message: `Invalid ${fieldName}. Expected a tenant UUID, not an email address or other text.`,
    };
  }

  return { ok: true, value: trimmed };
}
