import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PRODUCT_TYPE,
  ERP_SUITE_CATEGORY,
  LEGACY_PLATFORM_UNIT_ACTIVATION_PRODUCT_NAME,
  PLATFORM_BILLING_CATEGORY,
  SMS_CREDIT_CATALOG_NAME_PREFIX,
  SMS_CREDITS_CATEGORY,
  TENANCY_MANAGEMENT_CATEGORY,
  TENANCY_MANAGEMENT_ANNUAL_UNIT_BILLING_PRODUCT_NAME,
  TENANCY_MANAGEMENT_MONTHLY_UNIT_BILLING_PRODUCT_NAME,
  TENANCY_MANAGEMENT_UNIT_ACTIVATION_PRODUCT_NAME,
  isSystemManagedCrmProduct,
} from "@/app/dashboard/crm/products/products-utils";
import { resolveTenantPrimaryBusinessUnitId } from "@/utils/business-units-server";
import {
  getPlatformOnlyUnitActivationPriceGhs,
  getPlatformOnlyUnitAnnualPriceGhs,
} from "@/utils/platform-billing-config";
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

async function findManagedProductByName(
  admin: SupabaseClient,
  tenantId: string,
  category: string,
  name: string,
): Promise<ExistingManagedRow | null> {
  const { data, error } = await admin
    .from("crm_products")
    .select("id, business_unit_id")
    .eq("tenant_id", tenantId)
    .eq("category", category)
    .eq("name", name)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[sync-davors-system-crm-catalog] load failed (${name}): ${error.message}`,
    );
  }

  return (data as ExistingManagedRow | null) ?? null;
}

async function findManagedProductForUpsert(
  admin: SupabaseClient,
  tenantId: string,
  names: string[],
  categories: string[],
): Promise<ExistingManagedRow | null> {
  for (const name of names) {
    for (const category of categories) {
      const row = await findManagedProductByName(admin, tenantId, category, name);
      if (row) {
        return row;
      }
    }
  }
  return null;
}

async function upsertManagedProduct(
  admin: SupabaseClient,
  tenantId: string,
  primaryBusinessUnitId: string,
  match: { category: string; name: string },
  insertPayload: Record<string, unknown>,
  updatePayload: Record<string, unknown>,
  legacyNames: string[] = [],
): Promise<void> {
  const namesToSearch = [match.name, ...legacyNames];
  const categoriesToSearch = [match.category, PLATFORM_BILLING_CATEGORY];

  const existing = await findManagedProductForUpsert(
    admin,
    tenantId,
    namesToSearch,
    categoriesToSearch,
  );

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
  const payload: Record<string, unknown> = {
    ...updatePayload,
    name: match.name,
    category: match.category,
  };
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

async function syncTenancyManagementCatalogProducts(
  admin: SupabaseClient,
  tenantId: string,
  primaryBusinessUnitId: string,
): Promise<void> {
  const activationAndMonthlyPriceGhs =
    await getPlatformOnlyUnitActivationPriceGhs(admin);
  const annualPriceGhs = await getPlatformOnlyUnitAnnualPriceGhs(admin);

  const managedPayloadBase = {
    product_type: DEFAULT_PRODUCT_TYPE,
    is_active: true,
  };

  await upsertManagedProduct(
    admin,
    tenantId,
    primaryBusinessUnitId,
    {
      category: TENANCY_MANAGEMENT_CATEGORY,
      name: TENANCY_MANAGEMENT_UNIT_ACTIVATION_PRODUCT_NAME,
    },
    {
      ...managedPayloadBase,
      unit_price: activationAndMonthlyPriceGhs,
      billing_cycle: "one_time",
    },
    {
      ...managedPayloadBase,
      unit_price: activationAndMonthlyPriceGhs,
      billing_cycle: "one_time",
    },
    [LEGACY_PLATFORM_UNIT_ACTIVATION_PRODUCT_NAME],
  );

  await upsertManagedProduct(
    admin,
    tenantId,
    primaryBusinessUnitId,
    {
      category: TENANCY_MANAGEMENT_CATEGORY,
      name: TENANCY_MANAGEMENT_MONTHLY_UNIT_BILLING_PRODUCT_NAME,
    },
    {
      ...managedPayloadBase,
      unit_price: activationAndMonthlyPriceGhs,
      billing_cycle: "monthly",
    },
    {
      ...managedPayloadBase,
      unit_price: activationAndMonthlyPriceGhs,
      billing_cycle: "monthly",
    },
  );

  await upsertManagedProduct(
    admin,
    tenantId,
    primaryBusinessUnitId,
    {
      category: TENANCY_MANAGEMENT_CATEGORY,
      name: TENANCY_MANAGEMENT_ANNUAL_UNIT_BILLING_PRODUCT_NAME,
    },
    {
      ...managedPayloadBase,
      unit_price: annualPriceGhs,
      billing_cycle: "yearly",
    },
    {
      ...managedPayloadBase,
      unit_price: annualPriceGhs,
      billing_cycle: "yearly",
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
      { category: SMS_CREDITS_CATEGORY, name },
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

  await syncTenancyManagementCatalogProducts(
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
