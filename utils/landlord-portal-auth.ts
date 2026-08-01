import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import {
  formatRentLedgerStatus,
  rentOutstandingGhs,
  type RentLedgerStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import {
  formatRemittanceStatus,
  type RemittanceStatus,
} from "@/app/dashboard/real-estate/payouts-utils";
import {
  formatMaintenanceLandlordApproval,
  formatMaintenanceStatus,
  isLandlordApprovalStatus,
  isMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  formatLesseeComplaintStatus,
  isLesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import { isTerminationRequestStatus } from "@/app/dashboard/real-estate/leases-utils";

function formatTerminationRequestStatus(value: string): string {
  if (value === "pending_staff_approval") {
    return "Pending staff approval";
  }
  if (value === "approved") {
    return "Approved";
  }
  if (value === "rejected") {
    return "Rejected";
  }
  return value.replace(/_/g, " ");
}

export type LandlordPortalSession = {
  authUserId: string;
  email: string | null;
  tenantId: string;
  fullName: string;
  landlordType: LandlordType | null;
  approvalStatus: string | null;
};

export type LandlordPortalPropertyRow = {
  propertyId: string;
  name: string;
  city: string | null;
  unitCount: number;
};

export type LandlordPortalLeaseRow = {
  leaseId: string;
  propertyName: string;
  unitNumber: string;
  lesseeName: string;
  rentAmountGhs: number;
  status: string;
  startDate: string;
  endDate: string;
};

export type LandlordPortalRentSummary = {
  totalEntries: number;
  paidCount: number;
  unpaidCount: number;
  outstandingGhs: number;
  recent: Array<{
    entryId: string;
    lesseeName: string;
    unitLabel: string;
    periodStart: string;
    periodEnd: string;
    status: string;
    statusLabel: string;
    outstandingGhs: number;
  }>;
};

export type LandlordPortalPayoutRow = {
  payoutId: string;
  periodStart: string;
  periodEnd: string;
  netAmountGhs: number;
  remittanceStatus: RemittanceStatus;
  remittanceStatusLabel: string;
  remittanceDate: string | null;
};

export type LandlordPortalDashboardData = {
  landlordType: LandlordType | null;
  properties: LandlordPortalPropertyRow[];
  leases: LandlordPortalLeaseRow[];
  rent: LandlordPortalRentSummary;
  /** davors_managed only */
  escrowBalanceGhs: number | null;
  payouts: LandlordPortalPayoutRow[];
};

export type LandlordPortalMaintenanceRow = {
  requestId: string;
  description: string;
  statusLabel: string;
  landlordApprovalLabel: string;
  dateReported: string;
  lesseeName: string;
  unitLabel: string;
};

export type LandlordPortalComplaintRow = {
  complaintId: string;
  subject: string;
  statusLabel: string;
  dateReported: string;
  lesseeName: string;
  unitLabel: string;
};

export type LandlordPortalTerminationRow = {
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  statusLabel: string;
  reason: string | null;
  endDate: string;
};

/**
 * Resolves the signed-in Supabase user to a landlords row via auth_user_id.
 * Landlord portal auth is separate from user_accounts / staff RBAC.
 */
export async function getLandlordPortalSession(): Promise<LandlordPortalSession | null> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const admin = createAdminClient();
  const { data: landlord, error } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id, landlord_type, approval_status")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !landlord) {
    return null;
  }
  if (landlord.approval_status !== "approved") {
    return null;
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name, email")
    .eq("id", landlord.tenant_id)
    .maybeSingle();

  const landlordType =
    landlord.landlord_type === "platform_only" ||
    landlord.landlord_type === "davors_managed"
      ? landlord.landlord_type
      : null;

  return {
    authUserId: user.id,
    email: user.email ?? tenant?.email ?? null,
    tenantId: landlord.tenant_id,
    fullName: tenant?.name?.trim() || "Landlord",
    landlordType,
    approvalStatus: landlord.approval_status,
  };
}

export async function fetchLandlordPortalDashboardData(
  session: LandlordPortalSession,
): Promise<{ data: LandlordPortalDashboardData | null; error: string | null }> {
  const cookieStore = await cookies();
  const userClient = createClient(cookieStore);

  const primary = await loadDashboardWithClient(userClient, session);
  if (!primary.error && primary.data) {
    return primary;
  }

  const admin = createAdminClient();
  return loadDashboardWithClient(admin, session);
}

async function loadDashboardWithClient(
  client: SupabaseClient,
  session: LandlordPortalSession,
): Promise<{ data: LandlordPortalDashboardData | null; error: string | null }> {
  const tenantId = session.tenantId;

  const [
    { data: properties, error: propertiesError },
    { data: units, error: unitsError },
    { data: leases, error: leasesError },
    { data: lessees, error: lesseesError },
    { data: rentRows, error: rentError },
  ] = await Promise.all([
    client
      .from("properties")
      .select("property_id, name, city")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true }),
    client
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", tenantId),
    client
      .from("leases")
      .select(
        "lease_id, unit_id, lessee_id, start_date, end_date, rent_amount_ghs, status",
      )
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    client
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", tenantId),
    client
      .from("rent_ledger")
      .select(
        "entry_id, lease_id, period_start, period_end, status, amount_due_ghs, amount_paid_ghs, credit_ghs",
      )
      .eq("tenant_id", tenantId)
      .order("period_start", { ascending: false })
      .limit(40),
  ]);

  if (propertiesError) {
    return { data: null, error: propertiesError.message };
  }
  if (unitsError) {
    return { data: null, error: unitsError.message };
  }
  if (leasesError) {
    return { data: null, error: leasesError.message };
  }
  if (lesseesError) {
    return { data: null, error: lesseesError.message };
  }
  if (rentError) {
    return { data: null, error: rentError.message };
  }

  const unitById = new Map(
    (
      (units as Array<{
        unit_id: string;
        unit_number: string;
        property_id: string;
      }> | null) ?? []
    ).map((row) => [row.unit_id, row]),
  );
  const propertyNameById = new Map(
    (
      (properties as Array<{
        property_id: string;
        name: string;
        city: string | null;
      }> | null) ?? []
    ).map((row) => [row.property_id, row.name]),
  );
  const lesseeNameById = new Map(
    ((lessees as Array<{ lessee_id: string; full_name: string }> | null) ?? []).map(
      (row) => [row.lessee_id, row.full_name],
    ),
  );
  const leaseById = new Map(
    (
      (leases as Array<{
        lease_id: string;
        unit_id: string;
        lessee_id: string;
      }> | null) ?? []
    ).map((row) => [row.lease_id, row]),
  );

  const unitCountByProperty = new Map<string, number>();
  for (const unit of unitById.values()) {
    unitCountByProperty.set(
      unit.property_id,
      (unitCountByProperty.get(unit.property_id) ?? 0) + 1,
    );
  }

  const propertyRows: LandlordPortalPropertyRow[] = (
    (properties as Array<{
      property_id: string;
      name: string;
      city: string | null;
    }> | null) ?? []
  ).map((row) => ({
    propertyId: row.property_id,
    name: row.name,
    city: row.city,
    unitCount: unitCountByProperty.get(row.property_id) ?? 0,
  }));

  const leaseRows: LandlordPortalLeaseRow[] = (
    (leases as Array<{
      lease_id: string;
      unit_id: string;
      lessee_id: string;
      start_date: string;
      end_date: string;
      rent_amount_ghs: number | string;
      status: string;
    }> | null) ?? []
  ).map((row) => {
    const unit = unitById.get(row.unit_id);
    return {
      leaseId: row.lease_id,
      propertyName: unit
        ? (propertyNameById.get(unit.property_id) ?? "—")
        : "—",
      unitNumber: unit?.unit_number ?? "—",
      lesseeName: lesseeNameById.get(row.lessee_id) ?? "—",
      rentAmountGhs: Number(row.rent_amount_ghs) || 0,
      status: row.status,
      startDate: row.start_date,
      endDate: row.end_date,
    };
  });

  const ledger =
    (rentRows as Array<{
      entry_id: string;
      lease_id: string;
      period_start: string;
      period_end: string;
      status: string;
      amount_due_ghs: number | string;
      amount_paid_ghs: number | string;
      credit_ghs?: number | string | null;
    }> | null) ?? [];

  let paidCount = 0;
  let unpaidCount = 0;
  let outstandingGhs = 0;
  const recent: LandlordPortalRentSummary["recent"] = [];

  for (const row of ledger) {
    const amountDue = Number(row.amount_due_ghs) || 0;
    const amountPaid = Number(row.amount_paid_ghs) || 0;
    const creditGhs = Number(row.credit_ghs) || 0;
    const outstanding = rentOutstandingGhs(amountDue, amountPaid, creditGhs);
    if (row.status === "paid" || outstanding <= 0) {
      paidCount += 1;
    } else {
      unpaidCount += 1;
      outstandingGhs += outstanding;
    }

    if (recent.length < 12) {
      const lease = leaseById.get(row.lease_id);
      const unit = lease ? unitById.get(lease.unit_id) : undefined;
      recent.push({
        entryId: row.entry_id,
        lesseeName: lease
          ? (lesseeNameById.get(lease.lessee_id) ?? "—")
          : "—",
        unitLabel: unit
          ? `${propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
          : "—",
        periodStart: row.period_start,
        periodEnd: row.period_end,
        status: row.status,
        statusLabel: formatRentLedgerStatus(row.status as RentLedgerStatus),
        outstandingGhs: outstanding,
      });
    }
  }

  let escrowBalanceGhs: number | null = null;
  let payouts: LandlordPortalPayoutRow[] = [];

  if (session.landlordType === "davors_managed") {
    const [{ data: escrow }, { data: payoutRows, error: payoutError }] =
      await Promise.all([
        client
          .from("escrow_ledger")
          .select("balance_after_ghs, entry_date, created_at")
          .eq("tenant_id", tenantId)
          .order("entry_date", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        client
          .from("landlord_payouts")
          .select(
            "payout_id, period_start, period_end, net_amount_ghs, remittance_status, remittance_date",
          )
          .eq("tenant_id", tenantId)
          .order("period_start", { ascending: false })
          .limit(12),
      ]);

    if (payoutError) {
      return { data: null, error: payoutError.message };
    }

    escrowBalanceGhs = Number(escrow?.balance_after_ghs) || 0;
    payouts = (
      (payoutRows as Array<{
        payout_id: string;
        period_start: string;
        period_end: string;
        net_amount_ghs: number | string;
        remittance_status: string;
        remittance_date: string | null;
      }> | null) ?? []
    )
      .filter(
        (row) =>
          row.remittance_status === "pending" ||
          row.remittance_status === "remitted",
      )
      .map((row) => ({
        payoutId: row.payout_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        netAmountGhs: Number(row.net_amount_ghs) || 0,
        remittanceStatus: row.remittance_status as RemittanceStatus,
        remittanceStatusLabel: formatRemittanceStatus(row.remittance_status),
        remittanceDate: row.remittance_date,
      }));
  }

  return {
    data: {
      landlordType: session.landlordType,
      properties: propertyRows,
      leases: leaseRows,
      rent: {
        totalEntries: ledger.length,
        paidCount,
        unpaidCount,
        outstandingGhs,
        recent,
      },
      escrowBalanceGhs,
      payouts,
    },
    error: null,
  };
}

export async function fetchLandlordPortalMaintenance(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalMaintenanceRow[]; error: string | null }> {
  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const [
    { data: requests, error: requestsError },
    { data: leases },
    { data: units },
    { data: properties },
    { data: lessees },
  ] = await Promise.all([
    admin
      .from("maintenance_requests")
      .select(
        "request_id, lease_id, description, status, landlord_approval_status, date_reported",
      )
      .eq("tenant_id", tenantId)
      .order("date_reported", { ascending: false })
      .limit(50),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", tenantId),
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", tenantId),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", tenantId),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", tenantId),
  ]);

  if (requestsError) {
    return { rows: [], error: requestsError.message };
  }

  const maps = buildLookupMaps(leases, units, properties, lessees);
  const rows: LandlordPortalMaintenanceRow[] = [];

  for (const row of (requests as Array<{
    request_id: string;
    lease_id: string;
    description: string;
    status: string;
    landlord_approval_status: string;
    date_reported: string;
  }> | null) ?? []) {
    if (!isMaintenanceStatus(row.status)) continue;
    if (!isLandlordApprovalStatus(row.landlord_approval_status)) continue;
    const lease = maps.leaseById.get(row.lease_id);
    const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;
    rows.push({
      requestId: row.request_id,
      description: row.description,
      statusLabel: formatMaintenanceStatus(row.status),
      landlordApprovalLabel: formatMaintenanceLandlordApproval(
        row.landlord_approval_status,
      ),
      dateReported: row.date_reported,
      lesseeName: lease
        ? (maps.lesseeNameById.get(lease.lessee_id) ?? "—")
        : "—",
      unitLabel: unit
        ? `${maps.propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
        : "—",
    });
  }

  return { rows, error: null };
}

export async function fetchLandlordPortalComplaints(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalComplaintRow[]; error: string | null }> {
  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const [
    { data: complaints, error: complaintsError },
    { data: leases },
    { data: units },
    { data: properties },
    { data: lessees },
  ] = await Promise.all([
    admin
      .from("lessee_complaints")
      .select(
        "complaint_id, lease_id, lessee_id, subject, status, date_reported",
      )
      .eq("tenant_id", tenantId)
      .order("date_reported", { ascending: false })
      .limit(50),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", tenantId),
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", tenantId),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", tenantId),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", tenantId),
  ]);

  if (complaintsError) {
    return { rows: [], error: complaintsError.message };
  }

  const maps = buildLookupMaps(leases, units, properties, lessees);
  const rows: LandlordPortalComplaintRow[] = [];

  for (const row of (complaints as Array<{
    complaint_id: string;
    lease_id: string;
    lessee_id: string;
    subject: string;
    status: string;
    date_reported: string;
  }> | null) ?? []) {
    if (!isLesseeComplaintStatus(row.status)) continue;
    const lease = maps.leaseById.get(row.lease_id);
    const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;
    rows.push({
      complaintId: row.complaint_id,
      subject: row.subject,
      statusLabel: formatLesseeComplaintStatus(row.status),
      dateReported: row.date_reported,
      lesseeName: maps.lesseeNameById.get(row.lessee_id) ?? "—",
      unitLabel: unit
        ? `${maps.propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
        : "—",
    });
  }

  return { rows, error: null };
}

export async function fetchLandlordPortalTerminations(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalTerminationRow[]; error: string | null }> {
  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const [
    { data: leases, error: leasesError },
    { data: units },
    { data: properties },
    { data: lessees },
  ] = await Promise.all([
    admin
      .from("leases")
      .select(
        "lease_id, unit_id, lessee_id, end_date, termination_request_status, pending_termination_reason",
      )
      .eq("tenant_id", tenantId)
      .not("termination_request_status", "is", null)
      .order("updated_at", { ascending: false })
      .limit(50),
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", tenantId),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", tenantId),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", tenantId),
  ]);

  if (leasesError) {
    return { rows: [], error: leasesError.message };
  }

  const maps = buildLookupMaps(leases, units, properties, lessees);
  const rows: LandlordPortalTerminationRow[] = [];

  for (const row of (leases as Array<{
    lease_id: string;
    unit_id: string;
    lessee_id: string;
    end_date: string;
    termination_request_status: string | null;
    pending_termination_reason: string | null;
  }> | null) ?? []) {
    const status = row.termination_request_status;
    if (!status || !isTerminationRequestStatus(status)) continue;
    const unit = maps.unitById.get(row.unit_id);
    rows.push({
      leaseId: row.lease_id,
      lesseeName: maps.lesseeNameById.get(row.lessee_id) ?? "—",
      unitLabel: unit
        ? `${maps.propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
        : "—",
      statusLabel: formatTerminationRequestStatus(status),
      reason: row.pending_termination_reason?.trim() || null,
      endDate: row.end_date,
    });
  }

  return { rows, error: null };
}

function buildLookupMaps(
  leases: unknown,
  units: unknown,
  properties: unknown,
  lessees: unknown,
) {
  const leaseById = new Map(
    (
      (leases as Array<{
        lease_id: string;
        unit_id: string;
        lessee_id: string;
      }> | null) ?? []
    ).map((row) => [row.lease_id, row]),
  );
  const unitById = new Map(
    (
      (units as Array<{
        unit_id: string;
        unit_number: string;
        property_id: string;
      }> | null) ?? []
    ).map((row) => [row.unit_id, row]),
  );
  const propertyNameById = new Map(
    ((properties as Array<{ property_id: string; name: string }> | null) ?? []).map(
      (row) => [row.property_id, row.name],
    ),
  );
  const lesseeNameById = new Map(
    ((lessees as Array<{ lessee_id: string; full_name: string }> | null) ?? []).map(
      (row) => [row.lessee_id, row.full_name],
    ),
  );
  return { leaseById, unitById, propertyNameById, lesseeNameById };
}
