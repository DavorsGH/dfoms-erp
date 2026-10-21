import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export function manualSaleStockShortageMessage(input: {
  productName: string;
  unit: string;
  available: number;
  requested: number;
}): string {
  const unit = input.unit.trim();
  const availableLabel = Number.isFinite(input.available) ? String(input.available) : "0";
  const requestedLabel = Number.isFinite(input.requested) ? String(input.requested) : "0";
  return `Only ${availableLabel}${unit ? ` ${unit}` : ""} of ${input.productName} in stock, cannot sell ${requestedLabel}.`;
}

type SaleLine = {
  productId: string;
  quantity: number;
  productName?: string | null;
};

/**
 * Re-read finished-product balances immediately before a Paystack charge.
 * Returns a customer-facing sentence when any line is short.
 */
export async function manualSaleStockBlockReason(
  admin: SupabaseClient,
  tenantId: string,
  businessUnitId: string | null,
  lines: SaleLine[],
): Promise<string | null> {
  const needed = new Map<string, { quantity: number; name: string }>();
  for (const line of lines) {
    const productId = line.productId.trim();
    const quantity = Number(line.quantity);
    if (!productId || !Number.isFinite(quantity) || quantity <= 0) {
      continue;
    }
    const current = needed.get(productId);
    needed.set(productId, {
      quantity: (current?.quantity ?? 0) + quantity,
      name: line.productName?.trim() || current?.name || "this product",
    });
  }
  if (needed.size === 0) {
    return "Add a product before collecting payment.";
  }

  const productIds = [...needed.keys()];
  let balanceQuery = admin
    .from("finished_product_balances")
    .select("product_id, current_stock")
    .eq("tenant_id", tenantId)
    .in("product_id", productIds);
  balanceQuery =
    businessUnitId == null
      ? balanceQuery.is("business_unit_id", null)
      : balanceQuery.eq("business_unit_id", businessUnitId);
  const { data: balances, error: balanceError } = await balanceQuery;
  if (balanceError) {
    return balanceError.message;
  }

  const { data: products, error: productError } = await admin
    .from("finished_products")
    .select("id, product_name, unit_of_measure")
    .eq("tenant_id", tenantId)
    .in("id", productIds);
  if (productError) {
    return productError.message;
  }

  const stock = new Map<string, number>();
  for (const row of balances ?? []) {
    stock.set(String(row.product_id), Number(row.current_stock) || 0);
  }
  const units = new Map<string, { name: string; unit: string }>();
  for (const row of products ?? []) {
    units.set(String(row.id), {
      name: String(row.product_name ?? "").trim() || "this product",
      unit: String(row.unit_of_measure ?? "").trim(),
    });
  }

  for (const [productId, request] of needed) {
    const available = stock.get(productId) ?? 0;
    if (available + 0.0001 < request.quantity) {
      const product = units.get(productId);
      return manualSaleStockShortageMessage({
        productName: product?.name || request.name,
        unit: product?.unit ?? "",
        available,
        requested: request.quantity,
      });
    }
  }
  return null;
}
