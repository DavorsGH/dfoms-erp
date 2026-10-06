import type { BulkImportType } from "@/lib/bulk-import/types";
import { getBulkImportTargetFields } from "@/lib/bulk-import/target-fields";

const CODE_LIKE_FIELD_KEYS = new Set([
  "product_code",
  "barcode",
  "staff_id",
  "phone",
  "mobile",
  "account_number",
  "bank_account_number",
  "ghana_card",
  "ssnit",
  "tin",
  "tax_id",
  "registration_number",
  "serial_number",
  "asset_tag",
]);

export function isBulkImportCodeLikeFieldKey(fieldKey: string): boolean {
  return CODE_LIKE_FIELD_KEYS.has(fieldKey);
}

export function bulkImportCodeLikeFieldKeysForType(
  importType: BulkImportType,
): Set<string> {
  const keys = new Set<string>();
  for (const field of getBulkImportTargetFields(importType)) {
    if (isBulkImportCodeLikeFieldKey(field.key)) {
      keys.add(field.key);
    }
  }
  return keys;
}

const SCIENTIFIC_NOTATION_PATTERN =
  /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;

export function looksLikeExcelScientificNotation(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return false;
  }
  return SCIENTIFIC_NOTATION_PATTERN.test(trimmed);
}

export function bulkImportExcelCorruptedCodeMessage(
  columnLabel: string,
  cellValue: string,
): { problem: string; howToFix: string } {
  const display = cellValue.trim();
  return {
    problem: `${columnLabel} "${display}" was changed by Excel and lost digits.`,
    howToFix: `Format the ${columnLabel} column as Text in Excel, re-type the codes, and upload the file again.`,
  };
}
