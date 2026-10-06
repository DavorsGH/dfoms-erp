import type { BulkImportType } from "@/lib/bulk-import/types";

const IMPORTED_COUNT_LABEL: Record<
  BulkImportType,
  { one: string; many: string }
> = {
  product: { one: "1 product imported.", many: "N products imported." },
  service: { one: "1 service imported.", many: "N services imported." },
  employee: {
    one: "1 employee record imported.",
    many: "N employee records imported.",
  },
  customer: { one: "1 customer imported.", many: "N customers imported." },
  expense: {
    one: "1 expense entry imported.",
    many: "N expense entries imported.",
  },
  fixed_asset: {
    one: "1 fixed asset imported.",
    many: "N fixed assets imported.",
  },
};

export function formatBulkImportCommittedSummary(
  importType: BulkImportType,
  committedCount: number,
): string {
  const n = committedCount.toLocaleString("en-GB");
  if (committedCount === 1) {
    return IMPORTED_COUNT_LABEL[importType].one;
  }
  return IMPORTED_COUNT_LABEL[importType].many.replace("N", n);
}

export function formatBulkImportSkippedSummary(skippedCount: number): string {
  if (skippedCount === 1) {
    return "1 row was skipped because it had errors.";
  }
  return `${skippedCount.toLocaleString("en-GB")} rows were skipped because they had errors.`;
}

const IMPORT_VALID_ROW_NOUN: Record<
  BulkImportType,
  { one: string; many: string }
> = {
  product: { one: "product", many: "products" },
  service: { one: "service", many: "services" },
  employee: { one: "employee record", many: "employee records" },
  customer: { one: "customer", many: "customers" },
  expense: { one: "expense entry", many: "expense entries" },
  fixed_asset: { one: "fixed asset", many: "fixed assets" },
};

export function formatBulkImportPrimaryButtonLabel(
  importType: BulkImportType,
  validRows: number,
): string {
  if (validRows === 0) {
    return "Import";
  }
  const noun =
    validRows === 1
      ? IMPORT_VALID_ROW_NOUN[importType].one
      : IMPORT_VALID_ROW_NOUN[importType].many;
  return `Import ${validRows.toLocaleString("en-GB")} ${noun}`;
}
