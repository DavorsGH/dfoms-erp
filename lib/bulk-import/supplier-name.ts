export function normalizeSupplierNameKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function buildSupplierNameMatchCounts(
  suppliers: Array<{ name: string }>,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const supplier of suppliers) {
    const key = normalizeSupplierNameKey(supplier.name);
    if (!key) {
      continue;
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

export function validateSupplierNameLookup(
  supplierName: unknown,
  matchCounts: Map<string, number>,
): string | null {
  const trimmed = String(supplierName ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeSupplierNameKey(trimmed);
  const count = matchCounts.get(key) ?? 0;
  if (count > 1) {
    return "supplier_name matches multiple suppliers — use a unique name or fix duplicates in Suppliers";
  }

  return null;
}
