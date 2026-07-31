import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import type {
  LandlordApprovalStatus,
  LandlordDetail,
  LandlordListRow,
  LandlordSubscriptionDetails,
  LandlordSubscriptionStatus,
  LandlordSubscriptionTier,
  LandlordType,
} from "@/app/dashboard/real-estate/landlords-utils";

export type {
  LandlordApprovalStatus,
  LandlordDetail,
  LandlordListRow,
  LandlordSubscriptionDetails,
  LandlordSubscriptionStatus,
  LandlordSubscriptionTier,
  LandlordType,
} from "@/app/dashboard/real-estate/landlords-utils";

type TenantRow = {
  id: string;
  name: string;
  slug: string | null;
  status: string | null;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  tenant_code: string | null;
  product_line: string | null;
  created_at: string;
};

type LandlordRow = {
  tenant_id: string;
  landlord_type: LandlordType | null;
  approval_status: LandlordApprovalStatus | null;
  management_fee_percent: number | null;
  paystack_subaccount_code: string | null;
  sms_credit_balance: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type LandlordSubscriptionRow = {
  tenant_id: string;
  tier: LandlordSubscriptionTier | null;
  status: LandlordSubscriptionStatus | null;
  trial_ends_at: string | null;
  active_unit_count: number | null;
  current_period_price_ghs: number | null;
  included_units: number | null;
  extra_unit_price_ghs: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  base_price_ghs: number | null;
};

function mapSubscription(
  row: LandlordSubscriptionRow | null | undefined,
): LandlordSubscriptionDetails | null {
  if (!row) {
    return null;
  }

  return {
    tier: row.tier,
    status: row.status,
    trialEndsAt: row.trial_ends_at,
    activeUnitCount: row.active_unit_count,
    currentPeriodPriceGhs: row.current_period_price_ghs,
    includedUnits: row.included_units,
    extraUnitPriceGhs: row.extra_unit_price_ghs,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    basePriceGhs: row.base_price_ghs,
  };
}

/**
 * Lists real-estate landlord tenants for Davors staff.
 * Caller must already have verified Davors platform access.
 */
export async function fetchLandlordListRows(
  admin: SupabaseClient,
): Promise<{ rows: LandlordListRow[]; fetchError: string | null }> {
  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select(
      "id, name, slug, status, logo_url, address, phone, email, tenant_code, product_line, created_at",
    )
    .eq("product_line", "real_estate_only")
    .order("created_at", { ascending: false });

  if (tenantsError) {
    return { rows: [], fetchError: tenantsError.message };
  }

  const tenantRows = (tenants as TenantRow[] | null) ?? [];
  if (tenantRows.length === 0) {
    return { rows: [], fetchError: null };
  }

  const tenantIds = tenantRows.map((row) => row.id);

  const [
    { data: landlords, error: landlordsError },
    { data: subscriptions, error: subscriptionsError },
  ] = await Promise.all([
    admin.from("landlords").select("*").in("tenant_id", tenantIds),
    admin
      .from("landlord_subscriptions")
      .select(
        "tenant_id, tier, status, trial_ends_at, active_unit_count, current_period_price_ghs, included_units, extra_unit_price_ghs, current_period_start, current_period_end, base_price_ghs",
      )
      .in("tenant_id", tenantIds),
  ]);

  if (landlordsError) {
    return { rows: [], fetchError: landlordsError.message };
  }
  if (subscriptionsError) {
    return { rows: [], fetchError: subscriptionsError.message };
  }

  const landlordByTenant = new Map(
    ((landlords as LandlordRow[] | null) ?? []).map((row) => [
      row.tenant_id,
      row,
    ]),
  );
  const subscriptionByTenant = new Map(
    ((subscriptions as LandlordSubscriptionRow[] | null) ?? []).map((row) => [
      row.tenant_id,
      row,
    ]),
  );

  const rows: LandlordListRow[] = tenantRows.map((tenant) => {
    const landlord = landlordByTenant.get(tenant.id) ?? null;
    const subscription = subscriptionByTenant.get(tenant.id) ?? null;
    const isPlatformOnly = landlord?.landlord_type === "platform_only";

    return {
      tenantId: tenant.id,
      name: tenant.name,
      landlordType: landlord?.landlord_type ?? null,
      approvalStatus: landlord?.approval_status ?? null,
      subscriptionTier: isPlatformOnly ? (subscription?.tier ?? null) : null,
      createdAt: tenant.created_at,
    };
  });

  return { rows, fetchError: null };
}

/**
 * Loads one landlord detail record for Davors staff.
 * Caller must already have verified Davors platform access.
 */
export async function fetchLandlordDetail(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ detail: LandlordDetail | null; fetchError: string | null }> {
  if (!tenantId || tenantId === DAVORS_TENANT_ID) {
    return { detail: null, fetchError: null };
  }

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select(
      "id, name, slug, status, logo_url, address, phone, email, tenant_code, product_line, created_at",
    )
    .eq("id", tenantId)
    .eq("product_line", "real_estate_only")
    .maybeSingle();

  if (tenantError) {
    return { detail: null, fetchError: tenantError.message };
  }

  if (!tenant) {
    return { detail: null, fetchError: null };
  }

  const tenantRow = tenant as TenantRow;

  const [
    { data: landlord, error: landlordError },
    { data: subscription, error: subscriptionError },
  ] = await Promise.all([
    admin.from("landlords").select("*").eq("tenant_id", tenantId).maybeSingle(),
    admin
      .from("landlord_subscriptions")
      .select(
        "tenant_id, tier, status, trial_ends_at, active_unit_count, current_period_price_ghs, included_units, extra_unit_price_ghs, current_period_start, current_period_end, base_price_ghs",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (landlordError) {
    return { detail: null, fetchError: landlordError.message };
  }
  if (subscriptionError) {
    return { detail: null, fetchError: subscriptionError.message };
  }

  const landlordRow = (landlord as LandlordRow | null) ?? null;
  const subscriptionRow =
    (subscription as LandlordSubscriptionRow | null) ?? null;

  return {
    detail: {
      tenantId: tenantRow.id,
      name: tenantRow.name,
      slug: tenantRow.slug,
      status: tenantRow.status,
      logoUrl: tenantRow.logo_url,
      address: tenantRow.address,
      phone: tenantRow.phone,
      email: tenantRow.email,
      tenantCode: tenantRow.tenant_code,
      productLine: tenantRow.product_line,
      landlordType: landlordRow?.landlord_type ?? null,
      approvalStatus: landlordRow?.approval_status ?? null,
      managementFeePercent: landlordRow?.management_fee_percent ?? null,
      paystackSubaccountCode: landlordRow?.paystack_subaccount_code ?? null,
      smsCreditBalance: landlordRow?.sms_credit_balance ?? null,
      landlordCreatedAt: landlordRow?.created_at ?? null,
      landlordUpdatedAt: landlordRow?.updated_at ?? null,
      subscription:
        landlordRow?.landlord_type === "platform_only"
          ? mapSubscription(subscriptionRow)
          : null,
    },
    fetchError: null,
  };
}
