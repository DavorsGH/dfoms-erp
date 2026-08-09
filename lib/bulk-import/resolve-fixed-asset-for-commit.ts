import "server-only";

import type { Client } from "pg";
import { ASSET_ID_ENTITY_TYPE } from "@/app/dashboard/finance/asset-id-api";
import { normalizeTenantLookupKey } from "@/lib/bulk-import/tenant-name-lookup";

export type FixedAssetNameResolverCache = Map<string, string>;
export type FixedAssetPaymentMethodResolverCache = Map<string, string>;

async function generateNextCodeInTransaction(
  client: Client,
  tenantId: string,
  entityType: string,
): Promise<string> {
  const result = await client.query(
    `SELECT public.generate_next_code($1, $2, 4) AS code`,
    [tenantId, entityType],
  );

  const code = String(result.rows[0]?.code ?? "").trim();
  if (!code) {
    throw new Error(`generate_next_code returned an empty ${entityType} code.`);
  }

  return code;
}

export async function allocateFixedAssetIdForCommit(input: {
  client: Client;
  tenantId: string;
}): Promise<string> {
  return generateNextCodeInTransaction(
    input.client,
    input.tenantId,
    ASSET_ID_ENTITY_TYPE,
  );
}

async function resolveOptionalTenantNamedLookupForCommit(input: {
  client: Client;
  tenantId: string;
  tableName: "asset_categories" | "depreciation_methods";
  suppliedName: string;
  cache: FixedAssetNameResolverCache;
  entityLabel: string;
  fieldKey: string;
}): Promise<string | null> {
  const trimmed = input.suppliedName.trim();
  if (!trimmed) {
    return null;
  }

  const key = normalizeTenantLookupKey(trimmed);
  const cached = input.cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await input.client.query(
    `
      SELECT name
      FROM public.${input.tableName}
      WHERE tenant_id = $1
        AND lower(trim(name)) = $2
      ORDER BY name
    `,
    [input.tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `${input.fieldKey} "${trimmed}" matches multiple ${input.entityLabel} for this tenant`,
    );
  }

  if (existing.rows.length === 1) {
    const canonicalName = String(existing.rows[0].name);
    input.cache.set(key, canonicalName);
    return canonicalName;
  }

  const created = await input.client.query(
    `
      INSERT INTO public.${input.tableName} (tenant_id, name)
      VALUES ($1, $2)
      RETURNING name
    `,
    [input.tenantId, trimmed],
  );

  const canonicalName = String(created.rows[0].name);
  input.cache.set(key, canonicalName);
  return canonicalName;
}

export async function resolveAssetCategoryForCommit(input: {
  client: Client;
  tenantId: string;
  categoryName: string;
  cache: FixedAssetNameResolverCache;
}): Promise<string | null> {
  return resolveOptionalTenantNamedLookupForCommit({
    client: input.client,
    tenantId: input.tenantId,
    tableName: "asset_categories",
    suppliedName: input.categoryName,
    cache: input.cache,
    entityLabel: "asset categories",
    fieldKey: "asset_category",
  });
}

export async function resolveDepreciationMethodForCommit(input: {
  client: Client;
  tenantId: string;
  methodName: string;
  cache: FixedAssetNameResolverCache;
}): Promise<string | null> {
  return resolveOptionalTenantNamedLookupForCommit({
    client: input.client,
    tenantId: input.tenantId,
    tableName: "depreciation_methods",
    suppliedName: input.methodName,
    cache: input.cache,
    entityLabel: "depreciation methods",
    fieldKey: "depreciation_method",
  });
}

export async function resolveFixedAssetPaymentMethodForCommit(input: {
  client: Client;
  tenantId: string;
  paymentMethodName: string;
  cache: FixedAssetPaymentMethodResolverCache;
}): Promise<string> {
  const trimmed = input.paymentMethodName.trim() || "Cash";
  const key = normalizeTenantLookupKey(trimmed);
  const cached = input.cache.get(key);
  if (cached) {
    return cached;
  }

  const existing = await input.client.query(
    `
      SELECT name
      FROM public.payment_methods
      WHERE tenant_id = $1
        AND lower(trim(name)) = $2
      ORDER BY name
    `,
    [input.tenantId, key],
  );

  if (existing.rows.length > 1) {
    throw new Error(
      `payment_method "${trimmed}" matches multiple payment methods for this tenant`,
    );
  }

  if (existing.rows.length === 0) {
    throw new Error(`payment_method "${trimmed}" not found in payment methods`);
  }

  const canonicalName = String(existing.rows[0].name);
  input.cache.set(key, canonicalName);
  return canonicalName;
}

export async function syncFixedAssetPayableForCommit(input: {
  client: Client;
  tenantId: string;
  assetId: string;
  vendorName: string | null;
  purchaseDate: string;
  paymentMethod: string;
  totalCost: number;
  assetName: string;
}): Promise<string | null> {
  const result = await input.client.query(
    `
      SELECT public.sync_fixed_asset_payable(
        $1::uuid,
        $2,
        $3,
        $4::date,
        $5,
        $6,
        $7,
        $8::uuid
      ) AS payable_id
    `,
    [
      input.tenantId,
      input.assetId,
      input.vendorName,
      input.purchaseDate,
      input.paymentMethod,
      input.totalCost,
      input.assetName,
      null,
    ],
  );

  const payableId = result.rows[0]?.payable_id;
  if (payableId === null || payableId === undefined) {
    return null;
  }

  return String(payableId);
}
