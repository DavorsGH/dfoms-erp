import { normalizeColumnMatchKey } from "@/lib/bulk-import/bulk-import-wizard-utils";
import { isSpreadsheetPlaceholderCell } from "@/lib/spreadsheet/spreadsheet-matrix-utils";

export function pickSpreadsheetRecordValue(
  record: Record<string, unknown>,
  headerAliases: string[],
): unknown {
  const wanted = new Set(headerAliases.map((alias) => normalizeColumnMatchKey(alias)));

  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normalizeColumnMatchKey(key))) {
      return value;
    }
  }

  return undefined;
}

export function isSpreadsheetRecordBlankForFields(
  record: Record<string, unknown>,
  fieldAliasGroups: string[][],
): boolean {
  if (fieldAliasGroups.length === 0) {
    return isSpreadsheetPlaceholderRowRecord(record);
  }

  return fieldAliasGroups.every((aliases) =>
    isSpreadsheetPlaceholderCell(pickSpreadsheetRecordValue(record, aliases)),
  );
}

function isSpreadsheetPlaceholderRowRecord(record: Record<string, unknown>): boolean {
  const values = Object.values(record);
  if (values.length === 0) {
    return true;
  }

  return values.every(isSpreadsheetPlaceholderCell);
}
