import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/utils/supabase/admin";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import type { CrmSubscriptionStatus } from "@/utils/tenant-signup";

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
  product: { name: string } | { name: string }[] | null;
};

type CustomerRecord = {
  client_id: string;
  email: string | null;
};

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

function productNameFromRow(
  product: SubscriptionRecord["product"],
): string | null {
  if (!product) {
    return null;
  }

  if (Array.isArray(product)) {
    return product[0]?.name ?? null;
  }

  return product.name ?? null;
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
      "id, linked_tenant_id, customer_id, product_id, subscription_status, trial_end_date, created_at, product:crm_products(name)",
    )
    .in("linked_tenant_id", tenantIds)
    .order("created_at", { ascending: false });

  if (subscriptionsError) {
    return { rows: [], fetchError: subscriptionsError.message };
  }

  const subscriptionByTenant = latestSubscriptionByTenant(
    (subscriptions as SubscriptionRecord[] | null) ?? [],
  );

  const customerIds = [
    ...new Set(
      [...subscriptionByTenant.values()]
        .map((row) => row.customer_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];

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
    const tierName = productNameFromRow(subscription?.product ?? null);

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
