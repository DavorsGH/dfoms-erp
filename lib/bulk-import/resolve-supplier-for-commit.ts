import "server-only";

import type { Client } from "pg";
import { normalizeSupplierNameKey } from "@/lib/bulk-import/supplier-name";
import { DEFAULT_PAYMENT_TERMS_DAYS } from "@/utils/suppliers-types";

export type SupplierIdResolverCache = Map<string, string>;

export async function resolveSupplierIdForCommit(input: {
  client: Client;
  tenantId: string;
  supplierName: string | null;
  cache: SupplierIdResolverCache;
}): Promise<string | null> {
  const { client, tenantId, supplierName, cache } = input;
  const trimmed = supplierName?.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeSupplierNameKey(trimmed);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await client.query(
    `
      SELECT id
      FROM public.suppliers
      WHERE tenant_id = $1
        AND lower(trim(name)) = $2
      ORDER BY created_at, id
    `,
    [tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `supplier_name "${trimmed}" matches multiple suppliers for this tenant`,
    );
  }

  if (existing.rows.length === 1) {
    const supplierId = String(existing.rows[0].id);
    cache.set(key, supplierId);
    return supplierId;
  }

  const created = await client.query(
    `
      INSERT INTO public.suppliers (
        tenant_id,
        name,
        payment_terms_days,
        is_active,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, true, now(), now())
      RETURNING id
    `,
    [tenantId, trimmed, DEFAULT_PAYMENT_TERMS_DAYS],
  );

  const id = String(created.rows[0].id);
  cache.set(key, id);
  return id;
}
