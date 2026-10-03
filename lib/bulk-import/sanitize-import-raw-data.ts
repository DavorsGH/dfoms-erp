const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function sanitizeImportRawData(
  rawData: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawData)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

export function sanitizeImportHeaders(headers: unknown[]): string[] {
  if (!Array.isArray(headers)) {
    throw new Error("Invalid headers.");
  }

  const normalized = headers.map((header, index) => {
    const label = String(header ?? "").trim() || `Column ${index + 1}`;
    if (DANGEROUS_OBJECT_KEYS.has(label)) {
      throw new Error("Invalid headers.");
    }
    return label;
  });

  return normalized;
}
