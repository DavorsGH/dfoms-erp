export function generateBatchLabelPayload(
  barcode: string,
  batchNumber: string,
  expirationDate: string | null,
): string {
  return `${barcode}|${batchNumber}|${expirationDate ?? ""}`;
}

/**
 * Product scannable id for label payloads — prefers finished_products.barcode,
 * falls back to product_code only when barcode is null/blank.
 */
export function resolveProductBarcode(input: {
  barcode?: string | null;
  product_code: string;
}): string {
  const barcode = input.barcode?.trim();
  if (barcode) {
    return barcode;
  }

  const productCode = input.product_code.trim();
  if (!productCode) {
    throw new Error("Product barcode or product code is required for batch labels.");
  }

  return productCode;
}

export async function renderBarcodeImage(payload: string): Promise<string> {
  const text = payload.trim();
  if (!text) {
    throw new Error("Barcode payload is required.");
  }

  const bwipjs = await import("bwip-js/node");
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text,
    scale: 3,
    height: 12,
    includetext: false,
  });

  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}
