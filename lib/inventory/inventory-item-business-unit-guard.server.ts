import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchActiveBusinessUnitIds } from "@/utils/business-unit-access.server";
import {
  evaluateFinishedProductWriteBusinessUnit,
  evaluateRawMaterialWriteBusinessUnit,
  resolveInventoryItemBusinessUnitLabel,
  type InventoryItemBusinessUnitAction,
} from "@/lib/inventory/inventory-item-business-unit-guard";

export type InventoryBusinessUnitGuardResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

async function tenantUsesBusinessUnits(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const ids = await fetchActiveBusinessUnitIds(supabase, tenantId);
  return ids.length > 0;
}

let rawMaterialCatalogBusinessUnitColumn: boolean | null = null;

/** Raw material master rows may be tenant-wide until catalog BU tagging exists. */
async function rawMaterialCatalogSupportsBusinessUnitId(
  supabase: SupabaseClient,
): Promise<boolean> {
  if (rawMaterialCatalogBusinessUnitColumn !== null) {
    return rawMaterialCatalogBusinessUnitColumn;
  }

  const { error } = await supabase
    .from("raw_materials")
    .select("business_unit_id")
    .limit(1);

  rawMaterialCatalogBusinessUnitColumn = !error;
  return rawMaterialCatalogBusinessUnitColumn;
}

async function loadBusinessUnitNameMap(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(businessUnitIds.filter(Boolean))];
  if (uniqueIds.length === 0) {
    return new Map();
  }

  const { data, error } = await supabase
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("id", uniqueIds);

  if (error) {
    throw error;
  }

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(String(row.id), String(row.name ?? "").trim() || "another business unit");
  }
  return map;
}

function labelForBuId(
  businessUnitId: string | null,
  nameMap: Map<string, string>,
): string {
  if (!businessUnitId) {
    return "your workspace default";
  }
  return nameMap.get(businessUnitId) ?? "another business unit";
}

export async function guardFinishedProductWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  productId: string;
  writeBusinessUnitId: string | null;
  action: InventoryItemBusinessUnitAction;
}): Promise<InventoryBusinessUnitGuardResult> {
  if (!(await tenantUsesBusinessUnits(input.supabase, input.tenantId))) {
    return { ok: true };
  }

  const { data: product, error: productError } = await input.supabase
    .from("finished_products")
    .select("id, business_unit_id")
    .eq("id", input.productId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (productError) {
    return { ok: false, error: "Couldn't verify the product. Please try again.", status: 400 };
  }

  if (!product) {
    return { ok: false, error: "Product not found.", status: 404 };
  }

  const productBuId =
    (product as { business_unit_id?: string | null }).business_unit_id ?? null;

  const nameMap = await loadBusinessUnitNameMap(input.supabase, input.tenantId, [
    productBuId ?? "",
  ]);
  const label = labelForBuId(productBuId, nameMap);

  const evaluation = evaluateFinishedProductWriteBusinessUnit({
    tenantUsesBusinessUnits: true,
    productBusinessUnitId: productBuId,
    writeBusinessUnitId: input.writeBusinessUnitId,
    businessUnitLabel: label,
    action: input.action,
  });

  if (evaluation.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: evaluation.message,
    status: 409,
  };
}

export async function guardRawMaterialWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  materialId: string;
  writeBusinessUnitId: string | null;
  action: InventoryItemBusinessUnitAction;
}): Promise<InventoryBusinessUnitGuardResult> {
  if (!(await tenantUsesBusinessUnits(input.supabase, input.tenantId))) {
    return { ok: true };
  }

  if (!(await rawMaterialCatalogSupportsBusinessUnitId(input.supabase))) {
    return { ok: true };
  }

  const { data: material, error: materialError } = await input.supabase
    .from("raw_materials")
    .select("id, business_unit_id")
    .eq("id", input.materialId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();

  if (materialError) {
    return {
      ok: false,
      error: "Couldn't verify the raw material. Please try again.",
      status: 400,
    };
  }

  if (!material) {
    return { ok: false, error: "Raw material not found.", status: 404 };
  }

  const materialBuId =
    (material as { business_unit_id?: string | null }).business_unit_id ?? null;

  const nameMap = await loadBusinessUnitNameMap(input.supabase, input.tenantId, [
    materialBuId ?? "",
  ]);
  const label = labelForBuId(materialBuId, nameMap);

  const evaluation = evaluateRawMaterialWriteBusinessUnit({
    tenantUsesBusinessUnits: true,
    materialBusinessUnitId: materialBuId,
    writeBusinessUnitId: input.writeBusinessUnitId,
    businessUnitLabel: label,
    action: input.action,
  });

  if (evaluation.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    error: evaluation.message,
    status: 409,
  };
}

export async function guardPurchaseOrderItemsWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  writeBusinessUnitId: string | null;
  items: Array<{
    item_type?: string;
    raw_material_id?: string | null;
    finished_product_id?: string | null;
  }>;
}): Promise<InventoryBusinessUnitGuardResult> {
  if (!(await tenantUsesBusinessUnits(input.supabase, input.tenantId))) {
    return { ok: true };
  }

  const finishedProductIds = input.items
    .filter((line) => line.item_type === "finished_product")
    .map((line) => String(line.finished_product_id ?? "").trim())
    .filter(Boolean);

  const rawMaterialIds = input.items
    .filter((line) => line.item_type === "raw_material")
    .map((line) => String(line.raw_material_id ?? "").trim())
    .filter(Boolean);

  const [productsResult, materialsResult] = await Promise.all([
    finishedProductIds.length > 0
      ? input.supabase
          .from("finished_products")
          .select("id, business_unit_id")
          .eq("tenant_id", input.tenantId)
          .in("id", finishedProductIds)
      : Promise.resolve({ data: [], error: null }),
    rawMaterialIds.length > 0
      ? input.supabase
          .from("raw_materials")
          .select("id, business_unit_id")
          .eq("tenant_id", input.tenantId)
          .in("id", rawMaterialIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (productsResult.error || materialsResult.error) {
    return {
      ok: false,
      error: "Couldn't verify purchase order lines. Please try again.",
      status: 400,
    };
  }

  const buIds: string[] = [];
  for (const row of productsResult.data ?? []) {
    const bu = (row as { business_unit_id?: string | null }).business_unit_id;
    if (bu) buIds.push(bu);
  }
  for (const row of materialsResult.data ?? []) {
    const bu = (row as { business_unit_id?: string | null }).business_unit_id;
    if (bu) buIds.push(bu);
  }

  const nameMap = await loadBusinessUnitNameMap(
    input.supabase,
    input.tenantId,
    buIds,
  );

  for (const row of productsResult.data ?? []) {
    const productBuId =
      (row as { business_unit_id?: string | null }).business_unit_id ?? null;
    const evaluation = evaluateFinishedProductWriteBusinessUnit({
      tenantUsesBusinessUnits: true,
      productBusinessUnitId: productBuId,
      writeBusinessUnitId: input.writeBusinessUnitId,
      businessUnitLabel: labelForBuId(productBuId, nameMap),
      action: "purchase_order",
    });
    if (!evaluation.ok) {
      return { ok: false, error: evaluation.message, status: 409 };
    }
  }

  for (const row of materialsResult.data ?? []) {
    const materialBuId =
      (row as { business_unit_id?: string | null }).business_unit_id ?? null;
    const evaluation = evaluateRawMaterialWriteBusinessUnit({
      tenantUsesBusinessUnits: true,
      materialBusinessUnitId: materialBuId,
      writeBusinessUnitId: input.writeBusinessUnitId,
      businessUnitLabel: labelForBuId(materialBuId, nameMap),
      action: "purchase_order",
    });
    if (!evaluation.ok) {
      return { ok: false, error: evaluation.message, status: 409 };
    }
  }

  return { ok: true };
}

export async function guardProductionBatchWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  finishedProductId: string;
  materialIds: string[];
  writeBusinessUnitId: string | null;
}): Promise<InventoryBusinessUnitGuardResult> {
  const finishedGuard = await guardFinishedProductWriteBusinessUnit({
    supabase: input.supabase,
    tenantId: input.tenantId,
    productId: input.finishedProductId,
    writeBusinessUnitId: input.writeBusinessUnitId,
    action: "production",
  });
  if (!finishedGuard.ok) {
    return finishedGuard;
  }

  for (const materialId of [...new Set(input.materialIds.filter(Boolean))]) {
    const materialGuard = await guardRawMaterialWriteBusinessUnit({
      supabase: input.supabase,
      tenantId: input.tenantId,
      materialId,
      writeBusinessUnitId: input.writeBusinessUnitId,
      action: "production",
    });
    if (!materialGuard.ok) {
      return materialGuard;
    }
  }

  return { ok: true };
}

export { resolveInventoryItemBusinessUnitLabel };
