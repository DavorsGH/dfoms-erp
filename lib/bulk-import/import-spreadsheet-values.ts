export {
  parseBulkImportDateForCommit,
  parseBulkImportSpreadsheetDate,
} from "@/lib/bulk-import/bulk-import-date-column";

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return String(value).trim() === "";
}

export function trimBulkImportIdentifier(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  return String(value).replace(/\s+/g, " ").trim();
}
