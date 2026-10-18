import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateFinishedProductWriteBusinessUnit,
  evaluateRawMaterialWriteBusinessUnit,
  resolveInventoryItemBusinessUnitLabel,
  type InventoryItemBusinessUnitAction,
} from "@/lib/inventory/inventory-item-business-unit-guard";

let rawMaterialCatalogBusinessUnitColumn: boolean | null = null;

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

async function tenantUsesBusinessUnits(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("business_units")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

async function loadActiveBusinessUnits(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);

  if (error) {
    throw error;
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ""),
  }));
}

export async function verifyFinishedProductMatchesWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  productId: string;
  writeBusinessUnitId: string | null;
  action: InventoryItemBusinessUnitAction;
  /** When the caller already loaded catalog BU (e.g. product list). */
  knownProductBusinessUnitId?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const usesBu = await tenantUsesBusinessUnits(input.supabase, input.tenantId);
  if (!usesBu) {
    return { ok: true };
  }

  let productBusinessUnitId = input.knownProductBusinessUnitId ?? null;
  if (input.knownProductBusinessUnitId === undefined) {
    const { data: product, error } = await input.supabase
      .from("finished_products")
      .select("business_unit_id")
      .eq("id", input.productId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        message: "Couldn't verify the product. Please try again.",
      };
    }
    if (!product) {
      return { ok: false, message: "Product not found." };
    }
    productBusinessUnitId =
      (product as { business_unit_id?: string | null }).business_unit_id ?? null;
  }

  const units = await loadActiveBusinessUnits(input.supabase, input.tenantId);
  return evaluateFinishedProductWriteBusinessUnit({
    tenantUsesBusinessUnits: true,
    productBusinessUnitId,
    writeBusinessUnitId: input.writeBusinessUnitId,
    businessUnitLabel: resolveInventoryItemBusinessUnitLabel(
      productBusinessUnitId,
      units,
    ),
    action: input.action,
  });
}

export async function verifyRawMaterialMatchesWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  materialId: string;
  writeBusinessUnitId: string | null;
  action: InventoryItemBusinessUnitAction;
  knownMaterialBusinessUnitId?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const usesBu = await tenantUsesBusinessUnits(input.supabase, input.tenantId);
  if (!usesBu) {
    return { ok: true };
  }

  if (!(await rawMaterialCatalogSupportsBusinessUnitId(input.supabase))) {
    return { ok: true };
  }

  let materialBusinessUnitId = input.knownMaterialBusinessUnitId ?? null;
  if (input.knownMaterialBusinessUnitId === undefined) {
    const { data: material, error } = await input.supabase
      .from("raw_materials")
      .select("business_unit_id")
      .eq("id", input.materialId)
      .eq("tenant_id", input.tenantId)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        message: "Couldn't verify the raw material. Please try again.",
      };
    }
    if (!material) {
      return { ok: false, message: "Raw material not found." };
    }
    materialBusinessUnitId =
      (material as { business_unit_id?: string | null }).business_unit_id ?? null;
  }

  const units = await loadActiveBusinessUnits(input.supabase, input.tenantId);
  return evaluateRawMaterialWriteBusinessUnit({
    tenantUsesBusinessUnits: true,
    materialBusinessUnitId,
    writeBusinessUnitId: input.writeBusinessUnitId,
    businessUnitLabel: resolveInventoryItemBusinessUnitLabel(
      materialBusinessUnitId,
      units,
    ),
    action: input.action,
  });
}

export async function verifyProductionBatchMatchesWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  finishedProductId: string;
  materialIds: string[];
  writeBusinessUnitId: string | null;
  knownFinishedProductBusinessUnitId?: string | null;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const finishedCheck = await verifyFinishedProductMatchesWriteBusinessUnit({
    supabase: input.supabase,
    tenantId: input.tenantId,
    productId: input.finishedProductId,
    writeBusinessUnitId: input.writeBusinessUnitId,
    action: "production",
    knownProductBusinessUnitId: input.knownFinishedProductBusinessUnitId,
  });
  if (!finishedCheck.ok) {
    return finishedCheck;
  }

  for (const materialId of [...new Set(input.materialIds.filter(Boolean))]) {
    const materialCheck = await verifyRawMaterialMatchesWriteBusinessUnit({
      supabase: input.supabase,
      tenantId: input.tenantId,
      materialId,
      writeBusinessUnitId: input.writeBusinessUnitId,
      action: "production",
    });
    if (!materialCheck.ok) {
      return materialCheck;
    }
  }

  return { ok: true };
}

export async function verifyPosCartLinesMatchWriteBusinessUnit(input: {
  supabase: SupabaseClient;
  tenantId: string;
  productIds: string[];
  writeBusinessUnitId: string | null;
  productBusinessUnitById?: Map<string, string | null>;
}): Promise<{ ok: true } | { ok: false; message: string }> {
  for (const productId of [...new Set(input.productIds.filter(Boolean))]) {
    const knownBu = input.productBusinessUnitById?.get(productId);
    const check = await verifyFinishedProductMatchesWriteBusinessUnit({
      supabase: input.supabase,
      tenantId: input.tenantId,
      productId,
      writeBusinessUnitId: input.writeBusinessUnitId,
      action: "sale",
      knownProductBusinessUnitId: knownBu,
    });
    if (!check.ok) {
      return check;
    }
  }
  return { ok: true };
}
