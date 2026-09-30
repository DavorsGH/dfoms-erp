import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PAYMENT_ACCOUNT_SELECT,
  normalizePaymentAccountBusinessUnitIds,
  type PaymentAccountAvailability,
  type PaymentAccountRow,
} from "@/utils/payment-accounts-types";

type RawPaymentAccountRow = Omit<PaymentAccountRow, "business_unit_ids">;

export async function assertBusinessUnitsBelongToTenant(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitIds: string[],
): Promise<string | null> {
  const ids = normalizePaymentAccountBusinessUnitIds(businessUnitIds);
  if (ids.length === 0) {
    return null;
  }

  const { data, error } = await supabase
    .from("business_units")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  if (error) {
    return error.message;
  }

  const found = new Set((data ?? []).map((row) => row.id as string));
  if (ids.some((id) => !found.has(id))) {
    return "One or more business units were not found for this workspace.";
  }

  return null;
}

export async function assertPaymentAccountBusinessUnitForTenant(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitId: string | null | undefined,
): Promise<string | null> {
  const id = businessUnitId?.trim() || null;
  if (!id) {
    return null;
  }
  return assertBusinessUnitsBelongToTenant(supabase, tenantId, [id]);
}

export async function loadPaymentAccountBusinessUnitMap(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Map<string, string[]>> {
  const { data, error } = await supabase
    .from("payment_account_business_units")
    .select("payment_account_id, business_unit_id")
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(error.message);
  }

  const map = new Map<string, string[]>();
  for (const row of data ?? []) {
    const accountId = row.payment_account_id as string;
    const businessUnitId = row.business_unit_id as string;
    const list = map.get(accountId) ?? [];
    list.push(businessUnitId);
    map.set(accountId, list);
  }

  for (const [accountId, ids] of map) {
    map.set(accountId, normalizePaymentAccountBusinessUnitIds(ids));
  }

  return map;
}

export function attachBusinessUnitIdsToPaymentAccounts(
  accounts: RawPaymentAccountRow[],
  linkMap: Map<string, string[]>,
): PaymentAccountRow[] {
  return accounts.map((account) => ({
    ...account,
    business_unit_ids: linkMap.get(account.id) ?? [],
  }));
}

export async function loadPaymentAccountsForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PaymentAccountRow[]> {
  const [{ data, error }, linkMap] = await Promise.all([
    supabase
      .from("payment_accounts")
      .select(PAYMENT_ACCOUNT_SELECT)
      .eq("tenant_id", tenantId)
      .order("account_name", { ascending: true }),
    loadPaymentAccountBusinessUnitMap(supabase, tenantId),
  ]);

  if (error) {
    throw new Error(error.message);
  }

  return attachBusinessUnitIdsToPaymentAccounts(
    (data as RawPaymentAccountRow[] | null) ?? [],
    linkMap,
  );
}

export async function loadActivePaymentAccountsForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<PaymentAccountRow[]> {
  const accounts = await loadPaymentAccountsForTenant(supabase, tenantId);
  return accounts.filter((account) => account.is_active);
}

export async function loadPaymentAccountById(
  supabase: SupabaseClient,
  tenantId: string,
  accountId: string,
): Promise<PaymentAccountRow | null> {
  const { data, error } = await supabase
    .from("payment_accounts")
    .select(PAYMENT_ACCOUNT_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", accountId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const linkMap = await loadPaymentAccountBusinessUnitMap(supabase, tenantId);
  return attachBusinessUnitIdsToPaymentAccounts(
    [data as RawPaymentAccountRow],
    linkMap,
  )[0];
}

export async function replacePaymentAccountBusinessUnits(
  supabase: SupabaseClient,
  tenantId: string,
  paymentAccountId: string,
  availability: PaymentAccountAvailability,
  businessUnitIds: string[],
): Promise<string | null> {
  const { error: deleteError } = await supabase
    .from("payment_account_business_units")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("payment_account_id", paymentAccountId);

  if (deleteError) {
    return deleteError.message;
  }

  if (availability !== "selected") {
    return null;
  }

  const ids = normalizePaymentAccountBusinessUnitIds(businessUnitIds);
  const buError = await assertBusinessUnitsBelongToTenant(
    supabase,
    tenantId,
    ids,
  );
  if (buError) {
    return buError;
  }

  if (ids.length === 0) {
    return null;
  }

  const { error: insertError } = await supabase
    .from("payment_account_business_units")
    .insert(
      ids.map((businessUnitId) => ({
        tenant_id: tenantId,
        payment_account_id: paymentAccountId,
        business_unit_id: businessUnitId,
      })),
    );

  return insertError?.message ?? null;
}

export async function linkPaymentAccountToBusinessUnit(
  supabase: SupabaseClient,
  tenantId: string,
  paymentAccountId: string,
  businessUnitId: string,
): Promise<string | null> {
  const buError = await assertBusinessUnitsBelongToTenant(supabase, tenantId, [
    businessUnitId,
  ]);
  if (buError) {
    return buError;
  }

  const { error } = await supabase.from("payment_account_business_units").upsert(
    {
      tenant_id: tenantId,
      payment_account_id: paymentAccountId,
      business_unit_id: businessUnitId,
    },
    { onConflict: "payment_account_id,business_unit_id" },
  );

  return error?.message ?? null;
}

export async function unlinkPaymentAccountFromBusinessUnit(
  supabase: SupabaseClient,
  tenantId: string,
  paymentAccountId: string,
  businessUnitId: string,
): Promise<string | null> {
  const { error } = await supabase
    .from("payment_account_business_units")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("payment_account_id", paymentAccountId)
    .eq("business_unit_id", businessUnitId);

  return error?.message ?? null;
}
