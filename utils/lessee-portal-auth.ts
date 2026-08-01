import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { formatRentLedgerStatus } from "@/app/dashboard/real-estate/rent-ledger-utils";

export type PortalLesseeSession = {
  authUserId: string;
  email: string | null;
  tenantId: string;
  lesseeId: string;
  fullName: string;
};

export type PortalUnpaidRent = {
  entryId: string;
  periodStart: string;
  periodEnd: string;
  amountDueGhs: number;
  amountPaidGhs: number;
  outstandingGhs: number;
  status: string;
  statusLabel: string;
};

export type PortalDashboardData = {
  leaseId: string;
  propertyName: string;
  unitNumber: string;
  rentAmountGhs: number;
  leaseStartDate: string;
  leaseEndDate: string;
  leaseStatus: string;
  rentStatusLabel: string;
  rentPeriodStart: string | null;
  rentPeriodEnd: string | null;
  unpaidRent: PortalUnpaidRent | null;
  terminationRequestStatus: string | null;
  pendingTerminationReason: string | null;
};

/**
 * Resolves the signed-in Supabase user to a lessees row via auth_user_id.
 * Portal auth is separate from user_accounts / staff RBAC.
 */
export async function getPortalLesseeSession(): Promise<PortalLesseeSession | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Identity lookup hard-scoped to this auth user id.
  const admin = createAdminClient();
  const { data: lessee, error } = await admin
    .from("lessees")
    .select("tenant_id, lessee_id, full_name, email, auth_user_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !lessee) {
    return null;
  }

  return {
    authUserId: user.id,
    email: user.email ?? lessee.email ?? null,
    tenantId: lessee.tenant_id,
    lesseeId: lessee.lessee_id,
    fullName: lessee.full_name,
  };
}

export async function fetchPortalDashboardData(
  session: PortalLesseeSession,
): Promise<{ data: PortalDashboardData | null; error: string | null }> {
  const cookieStore = await cookies();
  const userClient = createClient(cookieStore);

  // Prefer user JWT + RLS. Fall back to admin with the same hard lessee scope.
  const primary = await loadDashboardWithClient(userClient, session);
  if (!primary.error && primary.data) {
    return primary;
  }

  const admin = createAdminClient();
  return loadDashboardWithClient(admin, session);
}

async function loadDashboardWithClient(
  client: SupabaseClient,
  session: PortalLesseeSession,
): Promise<{ data: PortalDashboardData | null; error: string | null }> {
  const { data: lease, error: leaseError } = await client
    .from("leases")
    .select(
      "lease_id, tenant_id, unit_id, lessee_id, start_date, end_date, rent_amount_ghs, status, termination_request_status, pending_termination_reason",
    )
    .eq("tenant_id", session.tenantId)
    .eq("lessee_id", session.lesseeId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (leaseError) {
    return { data: null, error: leaseError.message };
  }
  if (!lease) {
    return { data: null, error: null };
  }

  if (
    lease.lessee_id !== session.lesseeId ||
    lease.tenant_id !== session.tenantId
  ) {
    return { data: null, error: "Access denied." };
  }

  const [{ data: unit }, { data: rentRows }] = await Promise.all([
    client
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", session.tenantId)
      .eq("unit_id", lease.unit_id)
      .maybeSingle(),
    client
      .from("rent_ledger")
      .select(
        "entry_id, period_start, period_end, status, amount_due_ghs, amount_paid_ghs",
      )
      .eq("tenant_id", session.tenantId)
      .eq("lease_id", lease.lease_id)
      .order("period_start", { ascending: false })
      .limit(12),
  ]);

  let propertyName = "—";
  if (unit?.property_id) {
    const { data: property } = await client
      .from("properties")
      .select("name")
      .eq("tenant_id", session.tenantId)
      .eq("property_id", unit.property_id)
      .maybeSingle();
    propertyName = property?.name ?? "—";
  }

  const ledgerRows =
    (rentRows as Array<{
      entry_id: string;
      period_start: string;
      period_end: string;
      status: string;
      amount_due_ghs: number | string;
      amount_paid_ghs: number | string;
    }> | null) ?? [];

  const rentRow = ledgerRows[0] ?? null;
  const rentStatusLabel = rentRow?.status
    ? formatRentLedgerStatus(rentRow.status)
    : "No rent entries yet";

  // Most recent unpaid / partially paid row (portal Pay Rent target).
  let unpaidRent: PortalUnpaidRent | null = null;
  for (const row of ledgerRows) {
    if (row.status === "paid") {
      continue;
    }
    const amountDue = Number(row.amount_due_ghs) || 0;
    const amountPaid = Number(row.amount_paid_ghs) || 0;
    const outstanding = Math.round((amountDue - amountPaid + Number.EPSILON) * 100) / 100;
    if (outstanding <= 0) {
      continue;
    }
    unpaidRent = {
      entryId: row.entry_id,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      amountDueGhs: amountDue,
      amountPaidGhs: amountPaid,
      outstandingGhs: outstanding,
      status: row.status,
      statusLabel: formatRentLedgerStatus(row.status),
    };
    break;
  }

  return {
    data: {
      leaseId: lease.lease_id,
      propertyName,
      unitNumber: unit?.unit_number ?? "—",
      rentAmountGhs: Number(lease.rent_amount_ghs) || 0,
      leaseStartDate: lease.start_date,
      leaseEndDate: lease.end_date,
      leaseStatus: lease.status,
      rentStatusLabel,
      rentPeriodStart: rentRow?.period_start ?? null,
      rentPeriodEnd: rentRow?.period_end ?? null,
      unpaidRent,
      terminationRequestStatus:
        (lease.termination_request_status as string | null) ?? null,
      pendingTerminationReason:
        (lease.pending_termination_reason as string | null)?.trim() || null,
    },
    error: null,
  };
}
