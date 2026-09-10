import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import type { CrmSubscriptionStatus } from "@/utils/tenant-signup";
import { isValidUuid } from "@/utils/uuid-validation";

export type TenantStatus = "active" | "suspended";

export type CustomerTenantRow = {
  tenantId: string;
  companyName: string;
  signupDate: string;
  tenantStatus: TenantStatus;
  subscriptionId: string | null;
  subscriptionStatus: CrmSubscriptionStatus | null;
  trialEndDate: string | null;
  tierName: string | null;
  productId: string | null;
  contactEmail: string | null;
  billingWaived: boolean;
  billingWaivedReason: string | null;
  billingWaivedBy: string | null;
  billingWaivedAt: string | null;
  customPriceGhs: number | null;
  customPriceReason: string | null;
  /** auth.users id stored in crm_subscriptions.custom_price_set_by */
  customPriceSetBy: string | null;
  /** Display-only label resolved from user_accounts at read time */
  customPriceSetByLabel: string | null;
  customPriceSetAt: string | null;
  /** Tier the custom price override is locked to (crm_products.id). */
  customPriceTierProductId: string | null;
  customPriceTierName: string | null;
};

type TenantRecord = {
  id: string;
  name: string;
  status: TenantStatus;
  created_at: string;
};

type SubscriptionRecord = {
  id: string;
  linked_tenant_id: string | null;
  customer_id: string | null;
  product_id: string | null;
  subscription_status: CrmSubscriptionStatus;
  trial_end_date: string | null;
  created_at: string;
  billing_waived: boolean | null;
  billing_waived_reason: string | null;
  billing_waived_by: string | null;
  billing_waived_at: string | null;
  custom_price_ghs: number | null;
  custom_price_reason: string | null;
  custom_price_set_by: string | null;
  custom_price_set_at: string | null;
  custom_price_tier_product_id: string | null;
};

type CustomerRecord = {
  client_id: string;
  email: string | null;
};

type UserAccountActorRecord = {
  auth_uid: string;
  email: string | null;
  employees:
    | { full_name: string | null }
    | { full_name: string | null }[]
    | null;
};

function customPriceSetByLabelFromAccount(
  account: UserAccountActorRecord,
): string {
  const employee = Array.isArray(account.employees)
    ? account.employees[0]
    : account.employees;
  const fullName = employee?.full_name?.trim();
  if (fullName) {
    return fullName;
  }

  const email = account.email?.trim();
  if (email) {
    return email;
  }

  return account.auth_uid;
}

function latestSubscriptionByTenant(
  subscriptions: SubscriptionRecord[],
): Map<string, SubscriptionRecord> {
  const map = new Map<string, SubscriptionRecord>();

  for (const row of subscriptions) {
    if (!row.linked_tenant_id) {
      continue;
    }

    const existing = map.get(row.linked_tenant_id);
    if (!existing || row.created_at > existing.created_at) {
      map.set(row.linked_tenant_id, row);
    }
  }

  return map;
}

export async function fetchCustomerTenantRows(
  admin: SupabaseClient,
): Promise<{ rows: CustomerTenantRow[]; fetchError: string | null }> {
  const { data: tenants, error: tenantsError } = await admin
    .from("tenants")
    .select("id, name, status, created_at")
    .neq("id", DAVORS_TENANT_ID)
    .order("created_at", { ascending: false });

  if (tenantsError) {
    return { rows: [], fetchError: tenantsError.message };
  }

  const tenantRecords = (tenants as TenantRecord[] | null) ?? [];
  if (tenantRecords.length === 0) {
    return { rows: [], fetchError: null };
  }

  const tenantIds = tenantRecords.map((tenant) => tenant.id);

  const { data: subscriptions, error: subscriptionsError } = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, customer_id, product_id, subscription_status, trial_end_date, created_at, billing_waived, billing_waived_reason, billing_waived_by, billing_waived_at, custom_price_ghs, custom_price_reason, custom_price_set_by, custom_price_set_at, custom_price_tier_product_id",
    )
    .in("linked_tenant_id", tenantIds)
    .order("created_at", { ascending: false });

  if (subscriptionsError) {
    return { rows: [], fetchError: subscriptionsError.message };
  }

  const subscriptionRecords = (
    (subscriptions as SubscriptionRecord[] | null) ?? []
  ).filter(
    (row) =>
      Boolean(row.linked_tenant_id) && isValidUuid(row.linked_tenant_id ?? ""),
  );

  const productIds = [
    ...new Set(
      subscriptionRecords
        .flatMap((row) => [row.product_id, row.custom_price_tier_product_id])
        .filter(
          (value): value is string =>
            typeof value === "string" && isValidUuid(value),
        ),
    ),
  ];

  let productNameById = new Map<string, string>();

  if (productIds.length > 0) {
    const { data: products, error: productsError } = await admin
      .from("crm_products")
      .select("id, name")
      .in("id", productIds);

    if (productsError) {
      return { rows: [], fetchError: productsError.message };
    }

    productNameById = new Map(
      ((products as { id: string; name: string }[] | null) ?? []).map(
        (product) => [product.id, product.name],
      ),
    );
  }

  const subscriptionByTenant = latestSubscriptionByTenant(subscriptionRecords);

  const customerIds = [
    ...new Set(
      [...subscriptionByTenant.values()]
        .map((row) => row.customer_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const customPriceSetByIds = [
    ...new Set(
      [...subscriptionByTenant.values()]
        .map((row) => row.custom_price_set_by)
        .filter(
          (value): value is string =>
            typeof value === "string" && isValidUuid(value),
        ),
    ),
  ];

  let customPriceSetByLabelByAuthUid = new Map<string, string>();

  if (customPriceSetByIds.length > 0) {
    const { data: actorAccounts, error: actorAccountsError } = await admin
      .from("user_accounts")
      .select(
        "auth_uid, email, employees!user_accounts_employee_id_fkey(full_name)",
      )
      .in("auth_uid", customPriceSetByIds);

    if (actorAccountsError) {
      return { rows: [], fetchError: actorAccountsError.message };
    }

    customPriceSetByLabelByAuthUid = new Map(
      ((actorAccounts as UserAccountActorRecord[] | null) ?? []).map(
        (account) => [
          account.auth_uid,
          customPriceSetByLabelFromAccount(account),
        ],
      ),
    );
  }

  let customersById = new Map<string, CustomerRecord>();

  if (customerIds.length > 0) {
    const { data: customers, error: customersError } = await admin
      .from("customers")
      .select("client_id, email")
      .in("client_id", customerIds);

    if (customersError) {
      return { rows: [], fetchError: customersError.message };
    }

    customersById = new Map(
      ((customers as CustomerRecord[] | null) ?? []).map((customer) => [
        customer.client_id,
        customer,
      ]),
    );
  }

  const rows = tenantRecords.map((tenant) => {
    const subscription = subscriptionByTenant.get(tenant.id) ?? null;
    const customer = subscription?.customer_id
      ? customersById.get(subscription.customer_id)
      : null;
    const tierName =
      subscription?.product_id != null
        ? (productNameById.get(subscription.product_id) ?? null)
        : null;

    return {
      tenantId: tenant.id,
      companyName: tenant.name,
      signupDate: tenant.created_at,
      tenantStatus: tenant.status,
      subscriptionId: subscription?.id ?? null,
      subscriptionStatus: subscription?.subscription_status ?? null,
      trialEndDate: subscription?.trial_end_date ?? null,
      tierName,
      productId: subscription?.product_id ?? null,
      contactEmail: customer?.email ?? null,
      billingWaived: subscription?.billing_waived === true,
      billingWaivedReason: subscription?.billing_waived_reason ?? null,
      billingWaivedBy: subscription?.billing_waived_by ?? null,
      billingWaivedAt: subscription?.billing_waived_at ?? null,
      customPriceGhs:
        subscription?.custom_price_ghs != null
          ? Number(subscription.custom_price_ghs)
          : null,
      customPriceReason: subscription?.custom_price_reason ?? null,
      customPriceSetBy: subscription?.custom_price_set_by ?? null,
      customPriceSetByLabel: subscription?.custom_price_set_by
        ? (customPriceSetByLabelByAuthUid.get(subscription.custom_price_set_by) ??
          null)
        : null,
      customPriceSetAt: subscription?.custom_price_set_at ?? null,
      customPriceTierProductId:
        subscription?.custom_price_tier_product_id ?? null,
      customPriceTierName:
        subscription?.custom_price_tier_product_id != null
          ? (productNameById.get(subscription.custom_price_tier_product_id) ??
            null)
          : null,
    };
  });

  return { rows, fetchError: null };
}

export const getTenantStatus = cache(
  async (tenantId: string): Promise<TenantStatus | null> => {
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("tenants")
      .select("status")
      .eq("id", tenantId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    return (data?.status as TenantStatus | undefined) ?? null;
  },
);
