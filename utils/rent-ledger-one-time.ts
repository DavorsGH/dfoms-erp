import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type RentLedgerChargeType = "rent" | "one_time";

export function isRentLedgerChargeType(
  value: string | null | undefined,
): value is RentLedgerChargeType {
  return value === "rent" || value === "one_time";
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type CreateOneTimeChargeInput = {
  tenantId: string;
  leaseId: string;
  description: string;
  amountGhs: number;
  /** ISO date YYYY-MM-DD; defaults to today UTC. */
  chargeDate?: string;
};

export type CreateOneTimeChargeResult = {
  entryId: string;
  amountDueGhs: number;
  description: string;
  periodStart: string;
  periodEnd: string;
};

/**
 * Insert a one-time lease charge on rent_ledger.
 * period_start = period_end = charge date (due immediately; overdue cron fenced to rent).
 */
export async function createOneTimeLeaseCharge(
  admin: SupabaseClient,
  input: CreateOneTimeChargeInput,
): Promise<CreateOneTimeChargeResult> {
  const description = input.description.trim();
  if (!description) {
    throw new Error("description is required for a one-time charge.");
  }
  if (description.length > 500) {
    throw new Error("description must be 500 characters or fewer.");
  }

  const amountDue = roundMoney(Number(input.amountGhs));
  if (!Number.isFinite(amountDue) || amountDue <= 0) {
    throw new Error("amount must be a positive number.");
  }

  const chargeDate =
    input.chargeDate?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(chargeDate)) {
    throw new Error("charge date must be YYYY-MM-DD.");
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, tenant_id, status")
    .eq("tenant_id", input.tenantId)
    .eq("lease_id", input.leaseId)
    .maybeSingle();

  if (leaseError) {
    throw new Error(leaseError.message);
  }
  if (!lease) {
    throw new Error("Lease not found.");
  }
  if (lease.status !== "active") {
    throw new Error("One-time charges can only be added to an active lease.");
  }

  const entryId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  const { error: insertError } = await admin.from("rent_ledger").insert({
    tenant_id: input.tenantId,
    entry_id: entryId,
    lease_id: input.leaseId,
    charge_type: "one_time",
    description,
    period_start: chargeDate,
    period_end: chargeDate,
    amount_due_ghs: amountDue,
    amount_paid_ghs: 0,
    credit_ghs: 0,
    status: "pending",
    verification_status: "not_required",
    notes: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return {
    entryId,
    amountDueGhs: amountDue,
    description,
    periodStart: chargeDate,
    periodEnd: chargeDate,
  };
}
