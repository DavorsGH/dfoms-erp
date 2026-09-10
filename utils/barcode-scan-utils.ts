export const BARCODE_SCAN_INTER_KEY_MS = 50;

/** Batch labels encode `barcode|batch_number|expiration_date` — take first segment. */
export function parseBarcodeScanPayload(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  return (trimmed.split("|")[0] ?? "").trim();
}

export function matchesProductScanCode(
  product: { barcode?: string | null; product_code: string },
  scannedCode: string,
): boolean {
  const code = scannedCode.trim();
  if (!code) {
    return false;
  }
  const normalized = code.toLowerCase();
  const barcode = product.barcode?.trim();
  if (barcode && barcode.toLowerCase() === normalized) {
    return true;
  }
  return product.product_code.trim().toLowerCase() === normalized;
}

export function matchesMaterialScanCode(
  material: { material_code: string },
  scannedCode: string,
): boolean {
  const code = scannedCode.trim();
  if (!code) {
    return false;
  }
  return material.material_code.trim().toLowerCase() === code.toLowerCase();
}

export function findProductByScanCode<
  T extends { barcode?: string | null; product_code: string },
>(products: T[], scannedCode: string): T | undefined {
  const parsed = parseBarcodeScanPayload(scannedCode);
  if (!parsed) {
    return undefined;
  }
  return products.find((product) => matchesProductScanCode(product, parsed));
}

export function findMaterialByScanCode<
  T extends { material_code: string },
>(materials: T[], scannedCode: string): T | undefined {
  const parsed = parseBarcodeScanPayload(scannedCode);
  if (!parsed) {
    return undefined;
  }
  return materials.find((material) => matchesMaterialScanCode(material, parsed));
}
