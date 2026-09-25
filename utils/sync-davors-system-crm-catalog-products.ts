import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PRODUCT_TYPE,
  ERP_SUITE_CATEGORY,
  PLATFORM_BILLING_CATEGORY,
  PLATFORM_UNIT_ACTIVATION_PRODUCT_NAME,
  SMS_CREDIT_CATALOG_NAME_PREFIX,
  isSystemManagedCrmProduct,
} from "@/app/dashboard/crm/products/products-utils";
import { resolveTenantPrimaryBusinessUnitId } from "@/utils/business-units-server";
import { getPlatformOnlyUnitActivationPriceGhs } from "@/utils/platform-billing-config";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

type ExistingManagedRow = {
  id: string;
  business_unit_id: string | null;
};

function businessUnitIdForManagedUpdate(
  existingBusinessUnitId: string | null | undefined,
  primaryBusinessUnitId: string,
): string | undefined {
  const trimmed = existingBusinessUnitId?.trim() ?? "";
  if (trimmed === primaryBusinessUnitId) {
    return undefined;
  }
  if (!trimmed) {
    return primaryBusinessUnitId;
  }
  return undefined;
}

async function upsertManagedProduct(
  admin: SupabaseClient,
  tenantId: string,
  primaryBusinessUnitId: string,
  match: { category: string; name: string },
  insertPayload: Record<string, unknown>,
  updatePayload: Record<string, unknown>,
): Promise<void> {
  const { data: existing, error: fetchError } = await admin
    .from("crm_products")
    .select("id, business_unit_id")
    .eq("tenant_id", tenantId)
    .eq("category", match.category)
    .eq("name", match.name)
    .maybeSingle();

  if (fetchError) {
    throw new Error(
      `[sync-davors-system-crm-catalog] load failed (${match.name}): ${fetchError.message}`,
    );
  }

  if (!existing) {
    const { error: insertError } = await admin.from("crm_products").insert({
      tenant_id: tenantId,
      category: match.category,
      name: match.name,
      business_unit_id: primaryBusinessUnitId,
      ...insertPayload,
    });
    if (insertError) {
      throw new Error(
        `[sync-davors-system-crm-catalog] insert failed (${match.name}): ${insertError.message}`,
      );
    }
    return;
  }

  const row = existing as ExistingManagedRow;
  const payload = { ...updatePayload };
  const businessUnitId = businessUnitIdForManagedUpdate(
    row.business_unit_id,
    primaryBusinessUnitId,
  );
  if (businessUnitId) {
    payload.business_unit_id = businessUnitId;
  }

  const { error: updateError } = await admin
    .from("crm_products")
    .update(payload)
    .eq("id", row.id)
    .eq("tenant_id", tenantId);

  if (updateError) {
    throw new Error(
      `[sync-davors-system-crm-catalog] update failed (${match.name}): ${updateError.message}`,
    );
  }
}

async function syncPlatformUnitActivationProduct(
  admin: SupabaseClient,
  tenantId: string,
  primaryBusinessUnitId: string,
): Promise<void> {
  const priceGhs = await getPlatformOnlyUnitActivationPriceGhs(admin);
  await upsertManagedProduct(
    admin,
    tenantId,
    primaryBusinessUnitId,
    {
      category: PLATFORM_BILLING_CATEGORY,
      name: PLATFORM_UNIT_ACTIVATION_PRODUCT_NAME,
    },
    {
      product_type: DEFAULT_PRODUCT_TYPE,
      unit_price: priceGhs,
      billing_cycle: "one_time",
      is_active: true,
    },
    {
      product_type: DEFAULT_PRODUCT_TYPE,
      unit_price: priceGhs,
      billing_cycle: "one_time",
      is_active: true,
    },
  );
}

function smsCreditCatalogProductName(credits: number): string {
  return `${SMS_CREDIT_CATALOG_NAME_PREFIX}${credits} credits`;
}

async function syncSmsCreditPackProducts(
  admin: SupabaseClient,
  tenantId: string,
  primaryBusinessUnitId: string,
): Promise<void> {
  const { data: packs, error } = await admin
    .from("sms_credit_packs")
    .select("pack_key, credits, price_ghs, is_active")
    .order("credits", { ascending: true });

  if (error) {
    throw new Error(
      `[sync-davors-system-crm-catalog] sms_credit_packs read failed: ${error.message}`,
    );
  }

  for (const pack of packs ?? []) {
    const credits = Number(pack.credits);
    const priceGhs = Number(pack.price_ghs);
    if (!Number.isFinite(credits) || credits <= 0 || !Number.isFinite(priceGhs)) {
      continue;
    }

    const name = smsCreditCatalogProductName(credits);
    const isActive = pack.is_active !== false;

    await upsertManagedProduct(
      admin,
      tenantId,
      primaryBusinessUnitId,
      { category: PLATFORM_BILLING_CATEGORY, name },
      {
        product_type: DEFAULT_PRODUCT_TYPE,
        unit_price: priceGhs,
        billing_cycle: "one_time",
        is_active: isActive,
      },
      {
        product_type: DEFAULT_PRODUCT_TYPE,
        unit_price: priceGhs,
        billing_cycle: "one_time",
        is_active: isActive,
      },
    );
  }
}

async function stampErpSuiteTierBusinessUnitOnInsertOnly(
  admin: SupabaseClient,
  tenantId: string,
  primaryBusinessUnitId: string,
): Promise<void> {
  const { data: rows, error } = await admin
    .from("crm_products")
    .select("id, category, tier_slug, business_unit_id")
    .eq("tenant_id", tenantId)
    .eq("category", ERP_SUITE_CATEGORY)
    .not("tier_slug", "is", null);

  if (error) {
    throw new Error(
      `[sync-davors-system-crm-catalog] ERP tier load failed: ${error.message}`,
    );
  }

  for (const row of rows ?? []) {
    if (!isSystemManagedCrmProduct(row)) {
      continue;
    }
    const existingBu = (row.business_unit_id as string | null | undefined)?.trim() ?? "";
    if (existingBu) {
      continue;
    }
    const { error: updateError } = await admin
      .from("crm_products")
      .update({ business_unit_id: primaryBusinessUnitId })
      .eq("id", row.id)
      .eq("tenant_id", tenantId)
      .is("business_unit_id", null);
    if (updateError) {
      throw new Error(
        `[sync-davors-system-crm-catalog] ERP tier BU stamp failed: ${updateError.message}`,
      );
    }
  }
}

export async function syncDavorsSystemManagedCrmCatalogProducts(
  admin: SupabaseClient,
): Promise<void> {
  const primaryBusinessUnitId = await resolveTenantPrimaryBusinessUnitId(
    admin,
    DAVORS_TENANT_ID,
  );
  if (!primaryBusinessUnitId) {
    console.warn(
      "[sync-davors-system-crm-catalog] skipped — no active primary business unit for Davors tenant",
    );
    return;
  }

  await syncPlatformUnitActivationProduct(
    admin,
    DAVORS_TENANT_ID,
    primaryBusinessUnitId,
  );
  await syncSmsCreditPackProducts(admin, DAVORS_TENANT_ID, primaryBusinessUnitId);
  await stampErpSuiteTierBusinessUnitOnInsertOnly(
    admin,
    DAVORS_TENANT_ID,
    primaryBusinessUnitId,
  );
}
