export function normalizeTenantLookupKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function buildTenantNameMatchCounts(
  items: Array<{ name: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    const key = normalizeTenantLookupKey(item.name);
    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

export function validateTenantNameLookup(
  value: unknown,
  matchCounts: Map<string, number>,
  fieldKey: string,
  entityLabel: string,
): string | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const count = matchCounts.get(key) ?? 0;
  if (count > 1) {
    return `${fieldKey} matches multiple ${entityLabel} — use a more specific name or fix duplicates`;
  }

  return null;
}
