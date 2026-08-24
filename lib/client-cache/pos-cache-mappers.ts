import type { FinishedProductRecord } from "@/app/dashboard/inventory/finished-products-utils";
import type {
  CustomerBalanceCacheRow,
  CustomerBalancesCachePayload,
  StockLevelCacheRow,
  StockLevelsCachePayload,
} from "@/lib/client-cache/types";

export function finishedProductsToStockCachePayload(
  products: FinishedProductRecord[],
): StockLevelsCachePayload {
  const rows: StockLevelCacheRow[] = products.map((product) => ({
    id: product.id,
    product_code: product.product_code,
    product_name: product.product_name,
    unit_of_measure: product.unit_of_measure,
    current_stock: product.current_stock,
    standard_selling_price: product.standard_selling_price,
    sourcing_type: product.sourcing_type,
    supplier_id: product.supplier_id,
    photo_url: product.photo_url,
    is_archived: product.is_archived,
    created_at: product.created_at,
    updated_at: product.updated_at,
    manufacturing_date: product.manufacturing_date,
    expiration_date: product.expiration_date,
  }));
  return { products: rows };
}

export function stockCachePayloadToFinishedProducts(
  payload: StockLevelsCachePayload,
): FinishedProductRecord[] {
  return payload.products.map((row) => ({
    id: row.id,
    product_code: row.product_code,
    product_name: row.product_name,
    unit_of_measure: row.unit_of_measure,
    current_stock: row.current_stock,
    standard_selling_price: row.standard_selling_price,
    sourcing_type: (row.sourcing_type as FinishedProductRecord["sourcing_type"]) ?? null,
    supplier_id: row.supplier_id,
    photo_url: row.photo_url,
    is_archived: row.is_archived,
    created_at: row.created_at,
    updated_at: row.updated_at,
    manufacturing_date: row.manufacturing_date,
    expiration_date: row.expiration_date,
  }));
}

export function buildCustomerBalancesPayload(input: {
  clients: Array<{ client_id: string; client_name: string }>;
  loyaltyByClientId: Map<string, number>;
  openArByClientId: Map<string, number>;
}): CustomerBalancesCachePayload {
  const customers: CustomerBalanceCacheRow[] = input.clients.map((client) => ({
    client_id: client.client_id,
    client_name: client.client_name,
    loyalty_points: input.loyaltyByClientId.get(client.client_id) ?? 0,
    open_ar: input.openArByClientId.get(client.client_id) ?? 0,
  }));
  return { customers };
}

export function customerBalancesToMap(
  payload: CustomerBalancesCachePayload,
): Map<string, CustomerBalanceCacheRow> {
  return new Map(payload.customers.map((row) => [row.client_id, row]));
}
