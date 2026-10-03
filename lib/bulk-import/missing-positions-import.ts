import { normalizeTenantLookupKey } from "@/lib/bulk-import/tenant-name-lookup";
import type { EmployeeImportLookupContext } from "@/lib/bulk-import/validate-import-rows";

export type BulkImportMissingPositionSummary = {
  name: string;
  employee_count: number;
};

export function isEmployeeImportPositionKnown(
  positionTitle: unknown,
  employeeLookups: EmployeeImportLookupContext,
): boolean {
  const trimmed = String(positionTitle ?? "").trim();
  if (!trimmed) {
    return true;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const count = employeeLookups.positionTitleMatchCounts.get(key) ?? 0;
  return count === 1;
}

export function summarizeMissingImportPositions(
  rows: Array<{ mapped_data: Record<string, unknown> }>,
  employeeLookups: EmployeeImportLookupContext,
): BulkImportMissingPositionSummary[] {
  const byKey = new Map<string, { name: string; employee_count: number }>();

  for (const row of rows) {
    const raw = String(row.mapped_data.position_title ?? "").trim();
    if (!raw) {
      continue;
    }

    const key = normalizeTenantLookupKey(raw);
    const count = employeeLookups.positionTitleMatchCounts.get(key) ?? 0;
    if (count === 1) {
      continue;
    }

    if (count > 1) {
      continue;
    }

    const existing = byKey.get(key);
    if (existing) {
      existing.employee_count += 1;
      continue;
    }

    byKey.set(key, { name: raw, employee_count: 1 });
  }

  return [...byKey.values()].sort(
    (a, b) =>
      b.employee_count - a.employee_count || a.name.localeCompare(b.name),
  );
}
