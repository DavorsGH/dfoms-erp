import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import {
  isRemittanceStatus,
  roundPayoutMoney,
  type PayoutListRow,
  type RemittanceStatus,
} from "@/app/dashboard/real-estate/payouts-utils";

export type { PayoutListRow } from "@/app/dashboard/real-estate/payouts-utils";

export type LandlordPayoutContext = {
  tenantId: string;
  name: string;
  landlordType: LandlordType | null;
  managementFeePercent: number | null;
};

type PayoutRow = {
  tenant_id: string;
  payout_id: string;
  period_start: string;
  period_end: string;
  gross_amount_ghs: number | string;
  management_fee_ghs: number | string | null;
  net_amount_ghs: number | string;
  remittance_status: string;
  remittance_date: string | null;
  remittance_reference: string | null;
  created_at: string;
};

type RentPaymentRow = {
  entry_id: string;
  amount_paid_ghs: number | string;
  payment_date: string;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchLandlordPayoutContext(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{
  context: LandlordPayoutContext | null;
  fetchError: string | null;
}> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { context: null, fetchError: landlord.error };
  }

  const { data, error } = await admin
    .from("landlords")
    .select("landlord_type, management_fee_percent")
    .eq("tenant_id", landlord.tenantId)
    .maybeSingle();

  if (error) {
    return { context: null, fetchError: error.message };
  }

  const type = data?.landlord_type;
  const landlordType =
    type === "platform_only" || type === "davors_managed" ? type : null;

  return {
    context: {
      tenantId: landlord.tenantId,
      name: landlord.name,
      landlordType,
      managementFeePercent: toNumber(data?.management_fee_percent ?? null),
    },
    fetchError: null,
  };
}

export async function fetchPayoutsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: PayoutListRow[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const { data, error } = await admin
    .from("landlord_payouts")
    .select(
      "tenant_id, payout_id, period_start, period_end, gross_amount_ghs, management_fee_ghs, net_amount_ghs, remittance_status, remittance_date, remittance_reference, created_at",
    )
    .eq("tenant_id", landlord.tenantId)
    .order("period_start", { ascending: false });

  if (error) {
    return { rows: [], fetchError: error.message };
  }

  const rows: PayoutListRow[] = [];
  for (const row of (data as PayoutRow[] | null) ?? []) {
    if (!isRemittanceStatus(row.remittance_status)) {
      continue;
    }
    rows.push({
      payoutId: row.payout_id,
      tenantId: row.tenant_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      grossAmountGhs: toNumber(row.gross_amount_ghs) ?? 0,
      managementFeeGhs: toNumber(row.management_fee_ghs),
      netAmountGhs: toNumber(row.net_amount_ghs) ?? 0,
      remittanceStatus: row.remittance_status as RemittanceStatus,
      remittanceDate: row.remittance_date,
      remittanceReference: row.remittance_reference,
      createdAt: row.created_at,
    });
  }

  return { rows, fetchError: null };
}

export async function fetchEscrowBalanceForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ balanceGhs: number; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { balanceGhs: 0, fetchError: landlord.error };
  }

  const { data, error } = await admin
    .from("escrow_ledger")
    .select("balance_after_ghs, entry_date, created_at")
    .eq("tenant_id", landlord.tenantId)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { balanceGhs: 0, fetchError: error.message };
  }

  return {
    balanceGhs: toNumber(data?.balance_after_ghs) ?? 0,
    fetchError: null,
  };
}

/**
 * Rent ledger payments for this landlord tenant whose payment_date falls in
 * [periodStart, periodEnd] (inclusive, date-only comparison).
 */
export async function fetchRentPaymentsInPeriod(
  admin: SupabaseClient,
  tenantId: string,
  periodStart: string,
  periodEnd: string,
): Promise<{ payments: RentPaymentRow[]; fetchError: string | null }> {
  const { data: leases, error: leasesError } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", tenantId);

  if (leasesError) {
    return { payments: [], fetchError: leasesError.message };
  }

  const leaseIds = (
    (leases as Array<{ lease_id: string }> | null) ?? []
  ).map((row) => row.lease_id);

  if (leaseIds.length === 0) {
    return { payments: [], fetchError: null };
  }

  const periodEndExclusive = nextDay(periodEnd);

  const { data: ledger, error: ledgerError } = await admin
    .from("rent_ledger")
    .select("entry_id, amount_paid_ghs, payment_date, lease_id")
    .eq("tenant_id", tenantId)
    .in("lease_id", leaseIds)
    .not("payment_date", "is", null)
    .gt("amount_paid_ghs", 0)
    .gte("payment_date", `${periodStart}T00:00:00.000Z`)
    .lt("payment_date", `${periodEndExclusive}T00:00:00.000Z`);

  if (ledgerError) {
    return { payments: [], fetchError: ledgerError.message };
  }

  const payments: RentPaymentRow[] = (
    (ledger as Array<{
      entry_id: string;
      amount_paid_ghs: number | string;
      payment_date: string;
    }> | null) ?? []
  ).map((row) => ({
    entry_id: row.entry_id,
    amount_paid_ghs: row.amount_paid_ghs,
    payment_date: row.payment_date,
  }));

  return { payments, fetchError: null };
}

function nextDay(dateOnly: string): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function sumPaymentAmounts(payments: RentPaymentRow[]): number {
  let total = 0;
  for (const payment of payments) {
    total += toNumber(payment.amount_paid_ghs) ?? 0;
  }
  return roundPayoutMoney(total);
}
