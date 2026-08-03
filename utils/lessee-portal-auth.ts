import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { formatRentLedgerStatus, rentOutstandingGhs } from "@/app/dashboard/real-estate/rent-ledger-utils";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";

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
  propertyAddress: string;
  propertyLocation: string;
  unitNumber: string;
  rentAmountGhs: number;
  advanceRentAmountGhs: number;
  terminationNoticeMonths: number;
  leaseStartDate: string;
  leaseEndDate: string;
  leaseStatus: string;
  signatureStatus: string;
  landlordAcknowledgedAt: string | null;
  tenantAcknowledgedAt: string | null;
  landlordName: string;
  landlordAddress: string | null;
  landlordPhone: string | null;
  lesseeName: string;
  lesseePhone: string;
  lesseeEmail: string | null;
  depositAmountGhs: number | null;
  leaseDocumentUrl: string | null;
  leaseCreatedAt: string;
  lateFeeEnabled: boolean;
  lateFeeType: "fixed" | "percent" | null;
  lateFeeAmount: number | null;
  escalationPercent: number | null;
  escalationFrequencyMonths: number | null;
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

  // Deactivated portal users keep lessees.auth_user_id; Auth ban blocks access.
  const { data: authUserData } = await admin.auth.admin.getUserById(user.id);
  const bannedUntil =
    (authUserData?.user as { banned_until?: string | null } | undefined)
      ?.banned_until ?? null;
  if (isAuthUserBanned(bannedUntil)) {
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
      "lease_id, tenant_id, unit_id, lessee_id, start_date, end_date, rent_amount_ghs, advance_rent_amount_ghs, termination_notice_months, status, termination_request_status, pending_termination_reason, signature_status, lease_document_url, landlord_acknowledged_at, tenant_acknowledged_at, escalation_percent, escalation_frequency_months, late_fee_enabled, late_fee_type, late_fee_amount, created_at",
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

  const [
    { data: unit },
    { data: rentRows },
    { data: depositRows },
    { data: tenantRow },
    { data: landlordRow },
    { data: lesseeRow },
  ] = await Promise.all([
    client
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", session.tenantId)
      .eq("unit_id", lease.unit_id)
      .maybeSingle(),
    client
      .from("rent_ledger")
      .select(
        "entry_id, period_start, period_end, status, amount_due_ghs, amount_paid_ghs, credit_ghs",
      )
      .eq("tenant_id", session.tenantId)
      .eq("lease_id", lease.lease_id)
      .order("period_start", { ascending: false })
      .limit(12),
    client
      .from("security_deposits")
      .select("amount_ghs")
      .eq("tenant_id", session.tenantId)
      .eq("lease_id", lease.lease_id)
      .order("created_at", { ascending: false })
      .limit(1),
    client
      .from("tenants")
      .select("name, address, phone")
      .eq("id", session.tenantId)
      .maybeSingle(),
    client
      .from("landlords")
      .select("notification_phone")
      .eq("tenant_id", session.tenantId)
      .maybeSingle(),
    client
      .from("lessees")
      .select("full_name, phone, email")
      .eq("tenant_id", session.tenantId)
      .eq("lessee_id", session.lesseeId)
      .maybeSingle(),
  ]);

  let propertyName = "—";
  let propertyAddressLine1: string | null = null;
  let propertyAddressLine2: string | null = null;
  let propertyCity: string | null = null;
  let propertyRegion: string | null = null;
  if (unit?.property_id) {
    const { data: property } = await client
      .from("properties")
      .select("name, address_line1, address_line2, city, region")
      .eq("tenant_id", session.tenantId)
      .eq("property_id", unit.property_id)
      .maybeSingle();
    propertyName = property?.name ?? "—";
    propertyAddressLine1 =
      typeof property?.address_line1 === "string"
        ? property.address_line1
        : null;
    propertyAddressLine2 =
      typeof property?.address_line2 === "string"
        ? property.address_line2
        : null;
    propertyCity =
      typeof property?.city === "string" ? property.city : null;
    propertyRegion =
      typeof property?.region === "string" ? property.region : null;
  }

  const unitNumber = unit?.unit_number ?? "—";
  const street = [propertyAddressLine1, propertyAddressLine2]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
  const locality = [propertyCity, propertyRegion]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
  const unitLabel = unitNumber !== "—" ? `Unit ${unitNumber}` : null;
  const head = [propertyName !== "—" ? propertyName : null, unitLabel]
    .filter(Boolean)
    .join(" · ");
  const propertyAddress = [head, street, locality].filter(Boolean).join(", ") || "—";
  const propertyLocation =
    locality || (propertyName !== "—" ? propertyName : "—");

  const ledgerRows =
    (rentRows as Array<{
      entry_id: string;
      period_start: string;
      period_end: string;
      status: string;
      amount_due_ghs: number | string;
      amount_paid_ghs: number | string;
      credit_ghs?: number | string | null;
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
    const creditGhs = Number(row.credit_ghs) || 0;
    const outstanding = rentOutstandingGhs(amountDue, amountPaid, creditGhs);
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
      propertyAddress,
      propertyLocation,
      unitNumber,
      rentAmountGhs: Number(lease.rent_amount_ghs) || 0,
      advanceRentAmountGhs: Number(lease.advance_rent_amount_ghs) || 0,
      terminationNoticeMonths:
        typeof lease.termination_notice_months === "number" &&
        Number.isInteger(lease.termination_notice_months) &&
        lease.termination_notice_months >= 1
          ? lease.termination_notice_months
          : 3,
      leaseStartDate: lease.start_date,
      leaseEndDate: lease.end_date,
      leaseStatus: lease.status,
      signatureStatus:
        typeof lease.signature_status === "string" && lease.signature_status
          ? lease.signature_status
          : "unsigned",
      landlordAcknowledgedAt:
        (lease.landlord_acknowledged_at as string | null) ?? null,
      tenantAcknowledgedAt:
        (lease.tenant_acknowledged_at as string | null) ?? null,
      landlordName:
        typeof tenantRow?.name === "string" ? tenantRow.name : "—",
      landlordAddress:
        typeof tenantRow?.address === "string"
          ? tenantRow.address.trim() || null
          : null,
      landlordPhone:
        (typeof landlordRow?.notification_phone === "string"
          ? landlordRow.notification_phone.trim() || null
          : null) ??
        (typeof tenantRow?.phone === "string"
          ? tenantRow.phone.trim() || null
          : null),
      lesseeName:
        typeof lesseeRow?.full_name === "string"
          ? lesseeRow.full_name
          : session.fullName,
      lesseePhone:
        typeof lesseeRow?.phone === "string" ? lesseeRow.phone : "—",
      lesseeEmail:
        (typeof lesseeRow?.email === "string" ? lesseeRow.email : null) ??
        session.email,
      depositAmountGhs:
        depositRows && depositRows[0]
          ? Number(depositRows[0].amount_ghs) || 0
          : null,
      leaseDocumentUrl:
        typeof lease.lease_document_url === "string" &&
        lease.lease_document_url.trim()
          ? lease.lease_document_url.trim()
          : null,
      leaseCreatedAt:
        typeof lease.created_at === "string"
          ? lease.created_at
          : lease.start_date,
      lateFeeEnabled: Boolean(lease.late_fee_enabled),
      lateFeeType:
        lease.late_fee_type === "fixed" || lease.late_fee_type === "percent"
          ? lease.late_fee_type
          : null,
      lateFeeAmount:
        lease.late_fee_amount != null
          ? Number(lease.late_fee_amount) || null
          : null,
      escalationPercent:
        lease.escalation_percent != null
          ? Number(lease.escalation_percent) || null
          : null,
      escalationFrequencyMonths:
        lease.escalation_frequency_months != null
          ? Number(lease.escalation_frequency_months) || null
          : null,
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
