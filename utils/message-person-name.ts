export function resolveFirstName(options: {
  fullName: string | null | undefined;
  storedFirstName?: string | null;
}): string {
  const stored = options.storedFirstName?.trim();
  if (stored) {
    return stored;
  }

  const full = options.fullName?.trim() ?? "";
  if (!full) {
    return "";
  }

  const firstWord = full.split(/\s+/).filter(Boolean)[0]?.trim() ?? "";
  if (firstWord) {
    return firstWord;
  }

  return full;
}

export function resolveFullDisplayName(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return "";
}
