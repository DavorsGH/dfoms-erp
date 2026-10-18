const FINISHED_PRODUCT_BALANCE_WAC_PATTERN =
  /finished_product_balances\.average_cost_per_unit cannot be negative/i;

const PRODUCT_UUID_IN_WAC_ERROR =
  /product\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;

function looksLikePostgresSystemMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("violates") ||
    lower.includes("duplicate key") ||
    lower.includes("postgres") ||
    lower.includes("exception") ||
    FINISHED_PRODUCT_BALANCE_WAC_PATTERN.test(message)
  );
}

export function buildPosProductLabelById(
  cartLines: Array<{ productId: string; productCode: string; productName: string }>,
): Map<string, string> {
  return new Map(
    cartLines.map((line) => [
      line.productId,
      `${line.productCode} ${line.productName}`.trim(),
    ]),
  );
}

export function mapPosCheckoutRpcErrorMessage(
  error: { message?: string | null } | null | undefined,
  productLabelById?: Map<string, string>,
): string {
  const raw = error?.message?.trim() ?? "";
  if (!raw) {
    return "This sale could not be completed. Please try again.";
  }

  if (FINISHED_PRODUCT_BALANCE_WAC_PATTERN.test(raw)) {
    const productId = raw.match(PRODUCT_UUID_IN_WAC_ERROR)?.[1] ?? null;
    const label =
      (productId && productLabelById?.get(productId)) ||
      "one of the products in the cart";
    console.error("[pos-checkout]", raw);
    return `This sale could not be completed because of a stock costing problem on ${label}. Please contact support.`;
  }

  if (looksLikePostgresSystemMessage(raw)) {
    console.error("[pos-checkout]", raw);
    return "This sale could not be completed because of a system error. Please contact support.";
  }

  return raw;
}
