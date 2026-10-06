/** Scannable product id on finished_products (matches inventory-ids-api entity type). */
export const FINISHED_PRODUCT_BARCODE_ENTITY_TYPE = "BC";

/** Max length for user-supplied barcodes (batch labels encode barcode|batch|date). */
export const FINISHED_PRODUCT_BARCODE_MAX_LENGTH = 128;

const FINISHED_PRODUCT_BARCODE_PATTERN = /^[\x20-\x7E]+$/;

/**
 * Validates optional spreadsheet barcode values (manual create auto-allocates via generate_next_code).
 * Returns a legacy-style message for reviewIssuesFromLegacyErrorMessages.
 */
export function validateFinishedProductBarcodeForImport(
  value: unknown,
  fieldLabel: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.includes("|")) {
    return `${fieldLabel} can't contain the "|" character`;
  }

  if (trimmed.length > FINISHED_PRODUCT_BARCODE_MAX_LENGTH) {
    return `${fieldLabel} is too long (maximum ${FINISHED_PRODUCT_BARCODE_MAX_LENGTH} characters)`;
  }

  if (!FINISHED_PRODUCT_BARCODE_PATTERN.test(trimmed)) {
    return `${fieldLabel} contains invalid characters`;
  }

  return null;
}
