import type { ClientCacheSession } from "@/lib/client-cache/keys";
import {
  getCachedStockLevels,
  setCachedStockLevels,
} from "@/lib/client-cache/stock-levels-cache";

/** Optimistic UX-only stock decrement for queued offline cash sales. */
export async function applyOptimisticStockDecrement(
  session: ClientCacheSession,
  lines: Array<{ productId: string; quantity: number }>,
): Promise<void> {
  const cached = await getCachedStockLevels(session);
  if (!cached) return;

  const nextProducts = cached.payload.products.map((product) => {
    const delta = lines
      .filter((line) => line.productId === product.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (delta <= 0) return product;
    return {
      ...product,
      current_stock: Math.max(0, Number(product.current_stock) - delta),
    };
  });

  await setCachedStockLevels(session, {
    ...cached.payload,
    products: nextProducts,
  });
}

/** Restore optimistic decrement when a queued sale is discarded before sync. */
export async function restoreOptimisticStockDecrement(
  session: ClientCacheSession,
  lines: Array<{ productId: string; quantity: number }>,
): Promise<void> {
  const cached = await getCachedStockLevels(session);
  if (!cached) return;

  const nextProducts = cached.payload.products.map((product) => {
    const delta = lines
      .filter((line) => line.productId === product.id)
      .reduce((sum, line) => sum + line.quantity, 0);
    if (delta <= 0) return product;
    return {
      ...product,
      current_stock: Number(product.current_stock) + delta,
    };
  });

  await setCachedStockLevels(session, {
    ...cached.payload,
    products: nextProducts,
  });
}

export function buildOfflineProvisionalToken(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = crypto.randomUUID().slice(0, 8).toUpperCase();
  return `OFF-${stamp}-${rand}`;
}
