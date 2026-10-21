const INTERNAL_BARCODE = /^BC\d{4,}$/i;

export type FinishedProductBarcodeType = "internal" | "manufacturer";

export function classifyFinishedProductBarcode(
  barcode: string | null | undefined,
): FinishedProductBarcodeType {
  const value = barcode?.trim() ?? "";
  if (!value) {
    return "internal";
  }
  return INTERNAL_BARCODE.test(value) ? "internal" : "manufacturer";
}

export function isNonInternalBarcode(barcode: string | null | undefined): boolean {
  const value = barcode?.trim() ?? "";
  if (!value) {
    return false;
  }
  return !INTERNAL_BARCODE.test(value);
}
