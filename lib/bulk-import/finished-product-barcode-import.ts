import {
  barcodeImportCellToText,
  FINISHED_PRODUCT_BARCODE_MAX_LENGTH,
  parseProductBarcodeText,
} from "@/utils/finished-product-barcode-utils";

/** Scannable product id on finished_products (matches inventory-ids-api entity type). */
export const FINISHED_PRODUCT_BARCODE_ENTITY_TYPE = "BC";

export { FINISHED_PRODUCT_BARCODE_MAX_LENGTH };

/**
 * Validates optional spreadsheet barcode values (manual create auto-allocates via generate_next_code).
 * Returns a row error for reviewIssuesFromLegacyErrorMessages.
 */
export function validateFinishedProductBarcodeForImport(
  value: unknown,
  _fieldLabel: string,
): string | null {
  const text = barcodeImportCellToText(value);
  if (!text) {
    return null;
  }
  const parsed = parseProductBarcodeText(text);
  return parsed.ok ? null : parsed.error;
}
