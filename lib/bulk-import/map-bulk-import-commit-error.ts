import "server-only";

import type { BulkImportType } from "@/lib/bulk-import/types";

function importTypeNoun(importType: BulkImportType, count: number): string {
  switch (importType) {
    case "product":
      return count === 1 ? "product" : "products";
    case "service":
      return count === 1 ? "service" : "services";
    case "employee":
      return count === 1 ? "employee" : "employees";
    case "customer":
      return count === 1 ? "customer" : "customers";
    case "expense":
      return count === 1 ? "expense" : "expenses";
    case "fixed_asset":
      return count === 1 ? "fixed asset" : "fixed assets";
    default:
      return count === 1 ? "row" : "rows";
  }
}

function friendlyFromRawDatabaseMessage(
  raw: string,
  importType: BulkImportType,
): string | null {
  const normalized = raw.toLowerCase();

  if (normalized.includes('null value in column "barcode"')) {
    return "A product was missing a barcode. Check the file and upload it again.";
  }

  if (
    normalized.includes("duplicate key") &&
    (normalized.includes("product_code") || normalized.includes("finished_products"))
  ) {
    return "A product code in this file is already in Inventory.";
  }

  if (
    normalized.includes("duplicate key") &&
    normalized.includes("barcode")
  ) {
    return "A barcode in this file is already assigned to another product.";
  }

  if (normalized.includes("duplicate key") && normalized.includes("service_name")) {
    return "A service name in this file is already in your service catalog.";
  }

  if (normalized.includes("duplicate key") && normalized.includes("staff_id")) {
    return "A staff ID in this file is already in use.";
  }

  if (importType === "employee" && normalized.includes("salary settings")) {
    return "Employee import needs Salary Settings configured for this workspace.";
  }

  if (normalized.includes("violates not-null constraint")) {
    return `A required value was missing while importing ${importTypeNoun(importType, 2)}. Check the file and upload it again.`;
  }

  if (normalized.includes("violates foreign key constraint")) {
    return "A linked record could not be found. Check the file and upload it again.";
  }

  return null;
}

export function mapBulkImportCommitError(input: {
  error: unknown;
  importType: BulkImportType;
  rowCount: number;
}): string {
  const raw =
    input.error instanceof Error
      ? input.error.message
      : String(input.error ?? "Bulk import commit failed.");

  console.error("Bulk import commit failed", {
    importType: input.importType,
    rowCount: input.rowCount,
    error: raw,
  });

  const friendly = friendlyFromRawDatabaseMessage(raw, input.importType);
  if (friendly) {
    return friendly;
  }

  if (raw.startsWith("generate_next_code returned an empty")) {
    return "The system couldn't assign the next ID for this import. Please try again.";
  }

  if (
    raw.includes("Employee import requires Salary Settings") ||
    raw.includes("Unsupported import type")
  ) {
    return raw;
  }

  const noun = importTypeNoun(input.importType, input.rowCount);
  return `Couldn't import ${input.rowCount.toLocaleString()} ${noun}. Please try again.`;
}
