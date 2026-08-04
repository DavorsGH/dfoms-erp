import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import {
  formatRentLedgerStatus,
  isActiveLeaseStatus,
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
  normalizePhotoUrls,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  formatLesseeComplaintStatus,
  isLesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import { isTerminationRequestStatus } from "@/app/dashboard/real-estate/leases-utils";
import { isAuthUserBanned } from "@/utils/lessee-portal-account-management";
import {
  buildLandlordPortalFinancialSummary,
  type LandlordPortalFinancialSummaryViewModel,
} from "@/app/landlord-portal/dashboard/financial-summary-utils";

function formatTerminationRequestStatus(value: string): string {
  if (value === "pending_staff_approval") {
    return "Pending approval";
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
  logoUrl: string | null;
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
  status: string;
  statusLabel: string;
  landlordApprovalStatus: string;
  landlordApprovalLabel: string;
  tenantSelfFix: boolean;
  proposedCostGhs: number | null;
  costGhs: number | null;
  dateReported: string;
  lesseeName: string;
  unitLabel: string;
  photoUrls: string[];
  completionPhotoUrls: string[];
};

export type LandlordPortalComplaintRow = {
  complaintId: string;
  subject: string;
  description: string;
  status: string;
  statusLabel: string;
  staffResponse: string | null;
  dateReported: string;
  lesseeName: string;
  unitLabel: string;
};

export type LandlordPortalTerminationRow = {
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  requestStatus: string;
  statusLabel: string;
  reason: string | null;
  endDate: string;
};

/**
 * Session + service-role client for landlord-portal mutations.
 * Enforces platform_only (davors_managed cannot mutate even if UI is bypassed).
 */
/** True when the landlord may load operational portal data (RLS + admin fallback). */
export function landlordPortalHasDataAccess(
  session: LandlordPortalSession,
): boolean {
  return session.approvalStatus === "approved";
}

export async function requireApprovedLandlordSession(): Promise<
  | {
      ok: true;
      session: LandlordPortalSession;
      admin: ReturnType<typeof createAdminClient>;
    }
  | { ok: false; response: NextResponse }
> {
  const session = await getLandlordPortalSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!landlordPortalHasDataAccess(session)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Your landlord account is pending approval. Portal actions are unavailable until Davors staff approves your account.",
        },
        { status: 403 },
      ),
    };
  }
  return { ok: true, session, admin: createAdminClient() };
}

export async function requirePlatformOnlyLandlordSession(): Promise<
  | {
      ok: true;
      session: LandlordPortalSession;
      admin: ReturnType<typeof createAdminClient>;
    }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireApprovedLandlordSession();
  if (!auth.ok) {
    return auth;
  }
  if (auth.session.landlordType !== "platform_only") {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "Operational actions are only available for platform-only landlords.",
        },
        { status: 403 },
      ),
    };
  }
  return auth;
}

export async function fetchLandlordPortalNotificationContacts(
  session: LandlordPortalSession,
): Promise<{
  notificationPhone: string | null;
  notificationEmail: string | null;
  error: string | null;
}> {
  if (!landlordPortalHasDataAccess(session)) {
    return {
      notificationPhone: null,
      notificationEmail: null,
      error: null,
    };
  }

  const admin = createAdminClient();
  const [{ data: landlord, error: landlordError }, { data: tenant, error: tenantError }] =
    await Promise.all([
      admin
        .from("landlords")
        .select("notification_phone")
        .eq("tenant_id", session.tenantId)
        .maybeSingle(),
      admin
        .from("tenants")
        .select("email")
        .eq("id", session.tenantId)
        .maybeSingle(),
    ]);

  if (landlordError) {
    return {
      notificationPhone: null,
      notificationEmail: null,
      error: landlordError.message,
    };
  }
  if (tenantError) {
    return {
      notificationPhone: null,
      notificationEmail: null,
      error: tenantError.message,
    };
  }

  return {
    notificationPhone:
      typeof landlord?.notification_phone === "string"
        ? landlord.notification_phone
        : null,
    notificationEmail:
      typeof tenant?.email === "string" ? tenant.email : session.email,
    error: null,
  };
}

/**
 * Resolves the signed-in Supabase user to a landlords row via auth_user_id.
 * Allows pending/rejected so the portal can show a Pending Approval state.
 * Data access still requires approval_status = approved (RLS helper +
 * landlordPortalHasDataAccess / requirePlatformOnlyLandlordSession).
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
    .select(
      "tenant_id, auth_user_id, landlord_type, approval_status, logo_url",
    )
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error || !landlord) {
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
    logoUrl:
      typeof landlord.logo_url === "string" && landlord.logo_url.trim()
        ? landlord.logo_url.trim()
        : null,
    landlordType,
    approvalStatus: landlord.approval_status,
  };
}

export async function fetchLandlordPortalDashboardData(
  session: LandlordPortalSession,
): Promise<{ data: LandlordPortalDashboardData | null; error: string | null }> {
  // Never use the service-role fallback for unapproved landlords.
  if (!landlordPortalHasDataAccess(session)) {
    return { data: null, error: null };
  }

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
        status: string;
      }> | null) ?? []
    ).map((row) => [row.lease_id, row]),
  );
  const leaseStatusById = new Map(
    (
      (leases as Array<{ lease_id: string; status: string }> | null) ?? []
    ).map((row) => [row.lease_id, row.status]),
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
    const leaseActive = isActiveLeaseStatus(leaseStatusById.get(row.lease_id));
    if (!leaseActive) {
      continue;
    }

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
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

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
        "request_id, lease_id, description, status, landlord_approval_status, date_reported, tenant_self_fix, proposed_cost_ghs, cost_ghs, photo_urls, completion_photo_urls",
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
    tenant_self_fix?: boolean | null;
    proposed_cost_ghs?: number | string | null;
    cost_ghs?: number | string | null;
    photo_urls?: unknown;
    completion_photo_urls?: unknown;
  }> | null) ?? []) {
    if (!isMaintenanceStatus(row.status)) continue;
    if (!isLandlordApprovalStatus(row.landlord_approval_status)) continue;
    const lease = maps.leaseById.get(row.lease_id);
    const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;
    const proposed =
      row.proposed_cost_ghs == null ? null : Number(row.proposed_cost_ghs);
    const cost = row.cost_ghs == null ? null : Number(row.cost_ghs);
    rows.push({
      requestId: row.request_id,
      description: row.description,
      status: row.status,
      statusLabel: formatMaintenanceStatus(row.status),
      landlordApprovalStatus: row.landlord_approval_status,
      landlordApprovalLabel: formatMaintenanceLandlordApproval(
        row.landlord_approval_status,
      ),
      tenantSelfFix: Boolean(row.tenant_self_fix),
      proposedCostGhs:
        proposed != null && Number.isFinite(proposed) ? proposed : null,
      costGhs: cost != null && Number.isFinite(cost) ? cost : null,
      dateReported: row.date_reported,
      lesseeName: lease
        ? (maps.lesseeNameById.get(lease.lessee_id) ?? "—")
        : "—",
      unitLabel: unit
        ? `${maps.propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
        : "—",
      photoUrls: normalizePhotoUrls(row.photo_urls),
      completionPhotoUrls: normalizePhotoUrls(row.completion_photo_urls),
    });
  }

  return { rows, error: null };
}

export async function fetchLandlordPortalComplaints(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalComplaintRow[]; error: string | null }> {
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

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
        "complaint_id, lease_id, lessee_id, subject, description, status, staff_response, date_reported",
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
    description: string;
    status: string;
    staff_response: string | null;
    date_reported: string;
  }> | null) ?? []) {
    if (!isLesseeComplaintStatus(row.status)) continue;
    const lease = maps.leaseById.get(row.lease_id);
    const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;
    rows.push({
      complaintId: row.complaint_id,
      subject: row.subject,
      description: row.description,
      status: row.status,
      statusLabel: formatLesseeComplaintStatus(row.status),
      staffResponse: row.staff_response,
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
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

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
      requestStatus: status,
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
  const leaseRows =
    (leases as Array<{
      lease_id: string;
      unit_id: string;
      lessee_id: string;
      status?: string;
    }> | null) ?? [];
  const leaseById = new Map(leaseRows.map((row) => [row.lease_id, row]));
  const leaseStatusById = new Map(
    leaseRows.map((row) => [row.lease_id, row.status ?? ""]),
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
  return { leaseById, unitById, propertyNameById, lesseeNameById, leaseStatusById };
}

export type LandlordPortalArrearsBuckets = {
  days0to30: number;
  days31to60: number;
  days61Plus: number;
};

export type LandlordPortalUpcomingLease = {
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  endDate: string;
  daysUntilEnd: number;
};

export type LandlordPortalRentTrendPoint = {
  label: string;
  monthKey: string;
  collectedGhs: number;
  dueGhs: number;
};

export type LandlordPortalActivityItem = {
  id: string;
  type: "payment" | "maintenance" | "complaint" | "expense";
  label: string;
  detail: string;
  occurredAt: string;
};

export type LandlordPortalOverviewMetrics = {
  occupiedUnits: number;
  totalUnits: number;
  vacantUnits: number;
  occupancyRatePct: number;
  rentCollectedThisMonthGhs: number;
  outstandingBalanceGhs: number;
  openMaintenanceCount: number;
  openComplaintsCount: number;
  arrearsBuckets: LandlordPortalArrearsBuckets;
  upcomingLeaseExpirations: LandlordPortalUpcomingLease[];
  rentCollectionTrend: LandlordPortalRentTrendPoint[];
  expensesThisMonthGhs: number;
  netIncomeThisMonthGhs: number;
  recentActivity: LandlordPortalActivityItem[];
  financialSummary: LandlordPortalFinancialSummaryViewModel;
};

export type LandlordPortalPropertyBrowseRow = {
  propertyId: string;
  name: string;
  propertyType: string | null;
  city: string | null;
  region: string | null;
  addressLine1: string | null;
  unitCount: number;
  occupiedCount: number;
};

export type LandlordPortalUnitBrowseRow = {
  unitId: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  bedrooms: number | null;
  bathrooms: number | null;
  baseRentGhs: number;
  status: string;
};

export type LandlordPortalTenantBrowseRow = {
  lesseeId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  status: string | null;
};

export type LandlordPortalLeaseBrowseRow = LandlordPortalLeaseRow;

export type LandlordPortalRentLedgerBrowseRow = {
  entryId: string;
  leaseId: string;
  lesseeName: string;
  unitLabel: string;
  chargeType: "rent" | "one_time";
  description: string | null;
  periodStart: string;
  periodEnd: string;
  amountDueGhs: number;
  amountPaidGhs: number;
  creditGhs: number;
  outstandingGhs: number;
  status: string;
  statusLabel: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  notes: string | null;
};

export type LandlordPortalExpenseBrowseRow = {
  expenseId: string;
  propertyId: string;
  propertyName: string;
  category: string;
  amountGhs: number;
  expenseDate: string;
  description: string | null;
  receiptUrl: string | null;
};

export type LandlordPortalWorkspaceProfile = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
};

export type LandlordPortalLesseeAccountPortalStatus =
  | "active"
  | "disabled"
  | "pending_invite"
  | "no_account";

export type LandlordPortalLesseeAccountRow = {
  lesseeId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  portalStatus: LandlordPortalLesseeAccountPortalStatus;
  inviteExpiresAt: string | null;
  /** Active lease preferred; otherwise most recent lease for detail link. */
  leaseId: string | null;
  canResendInvite: boolean;
  /** platform_only only — Auth ban toggle for existing portal users. */
  canDeactivate: boolean;
  canReactivate: boolean;
  canResetPassword: boolean;
};

export type LandlordPortalSmsCreditPack = {
  packKey: string;
  credits: number;
  priceGhs: number;
  isActive: boolean;
};

/**
 * SCHEMA FLAG: `landlord_subscriptions` is read for platform_only display in
 * staff Landlords admin and landlord Billing Settings. No create/checkout
 * flow exists in landlord portal — do not invent ERP-suite subscription UX.
 */
export type LandlordPortalBillingSnapshot = {
  subscriptionTier: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  smsCreditBalance: number;
  smsCreditPacks: LandlordPortalSmsCreditPack[];
  billingEmail: string | null;
};

function monthBoundsIso(now = new Date()): { start: string; end: string } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return { start: toIso(start), end: toIso(end) };
}

function addCalendarDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = new Date(`${fromIso}T00:00:00`);
  const to = new Date(`${toIso}T00:00:00`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return 0;
  }
  return Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

function monthKeyFromIso(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return null;
  return isoDate.slice(0, 7);
}

function buildLastSixMonthKeys(now = new Date()): string[] {
  const keys: string[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    keys.push(`${year}-${month}`);
  }
  return keys;
}

function formatMonthTrendLabel(monthKey: string): string {
  const [yearText, monthText] = monthKey.split("-");
  const date = new Date(Number(yearText), Number(monthText) - 1, 1);
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export async function fetchLandlordPortalOverviewMetrics(
  session: LandlordPortalSession,
): Promise<{ data: LandlordPortalOverviewMetrics | null; error: string | null }> {
  if (!landlordPortalHasDataAccess(session)) {
    return { data: null, error: null };
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;
  const { start, end } = monthBoundsIso();
  const todayIso = new Date().toISOString().slice(0, 10);
  const horizon90 = addCalendarDaysIso(todayIso, 90);
  const trendKeys = buildLastSixMonthKeys();

  const [
    { data: units, error: unitsError },
    { data: rentRows, error: rentError },
    { data: maintenance, error: maintenanceError },
    { data: complaints, error: complaintsError },
    { data: expenses, error: expensesError },
    { data: leases, error: leasesError },
    { data: unitRows },
    { data: properties },
    { data: lessees },
  ] = await Promise.all([
    admin
      .from("property_units")
      .select("unit_id, status")
      .eq("tenant_id", tenantId),
    admin
      .from("rent_ledger")
      .select(
        "entry_id, lease_id, status, amount_due_ghs, amount_paid_ghs, credit_ghs, payment_date, period_start, period_end",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("maintenance_requests")
      .select(
        "request_id, status, landlord_approval_status, description, date_reported, lease_id",
      )
      .eq("tenant_id", tenantId)
      .order("date_reported", { ascending: false }),
    admin
      .from("lessee_complaints")
      .select("complaint_id, status, subject, date_reported, lease_id")
      .eq("tenant_id", tenantId)
      .order("date_reported", { ascending: false }),
    admin
      .from("property_expenses")
      .select(
        "expense_id, category, amount_ghs, expense_date, description, property_id, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("expense_date", { ascending: false }),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id, end_date, status")
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

  if (unitsError) return { data: null, error: unitsError.message };
  if (rentError) return { data: null, error: rentError.message };
  if (maintenanceError) return { data: null, error: maintenanceError.message };
  if (complaintsError) return { data: null, error: complaintsError.message };
  if (expensesError) return { data: null, error: expensesError.message };
  if (leasesError) return { data: null, error: leasesError.message };

  const maps = buildLookupMaps(leases, unitRows, properties, lessees);
  const propertyNameById = maps.propertyNameById;

  const unitList =
    (units as Array<{ unit_id: string; status: string }> | null) ?? [];
  const occupiedUnits = unitList.filter((u) => u.status === "occupied").length;
  const totalUnits = unitList.length;
  const vacantUnits = Math.max(0, totalUnits - occupiedUnits);
  const occupancyRatePct =
    totalUnits === 0 ? 0 : Math.round((occupiedUnits / totalUnits) * 1000) / 10;

  const arrearsBuckets: LandlordPortalArrearsBuckets = {
    days0to30: 0,
    days31to60: 0,
    days61Plus: 0,
  };
  const trendMap = new Map(
    trendKeys.map((key) => [key, { collectedGhs: 0, dueGhs: 0 }]),
  );

  let rentCollectedThisMonthGhs = 0;
  let outstandingBalanceGhs = 0;
  const activity: LandlordPortalActivityItem[] = [];

  for (const row of (rentRows as Array<{
    entry_id: string;
    lease_id: string;
    status: string;
    amount_due_ghs: number | string;
    amount_paid_ghs: number | string;
    credit_ghs?: number | string | null;
    payment_date: string | null;
    period_start: string;
    period_end: string;
  }> | null) ?? []) {
    const leaseActive = isActiveLeaseStatus(
      maps.leaseStatusById.get(row.lease_id),
    );
    const amountDue = Number(row.amount_due_ghs) || 0;
    const amountPaid = Number(row.amount_paid_ghs) || 0;
    const creditGhs = Number(row.credit_ghs) || 0;
    const outstanding = rentOutstandingGhs(amountDue, amountPaid, creditGhs);
    if (leaseActive) {
      outstandingBalanceGhs += outstanding;
    }

    const paidInMonth =
      row.payment_date &&
      row.payment_date >= start &&
      row.payment_date <= end;
    if (paidInMonth) {
      rentCollectedThisMonthGhs += amountPaid;
    }

    const dueMonth = monthKeyFromIso(row.period_start);
    if (dueMonth && trendMap.has(dueMonth)) {
      const point = trendMap.get(dueMonth)!;
      point.dueGhs += amountDue;
    }
    if (row.payment_date) {
      const paidMonth = monthKeyFromIso(row.payment_date);
      if (paidMonth && trendMap.has(paidMonth)) {
        const point = trendMap.get(paidMonth)!;
        point.collectedGhs += amountPaid;
      }
    }

    if (leaseActive && outstanding > 0 && row.period_end < todayIso) {
      const ageDays = daysBetweenIso(row.period_end, todayIso);
      if (ageDays <= 30) {
        arrearsBuckets.days0to30 += outstanding;
      } else if (ageDays <= 60) {
        arrearsBuckets.days31to60 += outstanding;
      } else {
        arrearsBuckets.days61Plus += outstanding;
      }
    }

    if (
      row.payment_date &&
      amountPaid > 0 &&
      row.payment_date >= addCalendarDaysIso(todayIso, -90)
    ) {
      const lease = maps.leaseById.get(row.lease_id);
      const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;
      const unitLabel = unit
        ? `${propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
        : "—";
      const lesseeName = lease
        ? (maps.lesseeNameById.get(lease.lessee_id) ?? "Tenant")
        : "Tenant";
      activity.push({
        id: `payment-${row.entry_id}`,
        type: "payment",
        label: "Rent payment",
        detail: `${lesseeName} · ${unitLabel} · GHS ${amountPaid.toFixed(2)}`,
        occurredAt: row.payment_date,
      });
    }
  }

  let expensesThisMonthGhs = 0;
  for (const row of (expenses as Array<{
    expense_id: string;
    category: string;
    amount_ghs: number | string;
    expense_date: string;
    description: string | null;
    property_id: string;
    created_at: string | null;
  }> | null) ?? []) {
    const amount = Number(row.amount_ghs) || 0;
    if (row.expense_date >= start && row.expense_date <= end) {
      expensesThisMonthGhs += amount;
    }
    if (row.expense_date >= addCalendarDaysIso(todayIso, -90)) {
      activity.push({
        id: `expense-${row.expense_id}`,
        type: "expense",
        label: "Expense logged",
        detail: `${propertyNameById.get(row.property_id) ?? "Property"} · ${row.category} · GHS ${amount.toFixed(2)}`,
        occurredAt: row.expense_date || row.created_at?.slice(0, 10) || todayIso,
      });
    }
  }

  for (const row of (
    (maintenance as Array<{
      request_id: string;
      status: string;
      landlord_approval_status: string;
      description: string;
      date_reported: string;
      lease_id: string;
    }> | null) ?? []
  ).slice(0, 15)) {
    const lease = maps.leaseById.get(row.lease_id);
    const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;
    const unitLabel = unit
      ? `${propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
      : "—";
    activity.push({
      id: `maintenance-${row.request_id}`,
      type: "maintenance",
      label: "Maintenance",
      detail: `${unitLabel} · ${row.description.slice(0, 80)}`,
      occurredAt: row.date_reported,
    });
  }

  for (const row of (
    (complaints as Array<{
      complaint_id: string;
      status: string;
      subject: string;
      date_reported: string;
      lease_id: string;
    }> | null) ?? []
  ).slice(0, 15)) {
    activity.push({
      id: `complaint-${row.complaint_id}`,
      type: "complaint",
      label: "Complaint",
      detail: row.subject,
      occurredAt: row.date_reported,
    });
  }

  const openMaintenanceCount = (
    (maintenance as Array<{
      status: string;
      landlord_approval_status: string;
    }> | null) ?? []
  ).filter(
    (row) =>
      row.landlord_approval_status === "pending" ||
      row.status === "submitted" ||
      row.status === "in_progress" ||
      row.status === "approved",
  ).length;

  const openComplaintsCount = (
    (complaints as Array<{ status: string }> | null) ?? []
  ).filter(
    (row) => row.status === "submitted" || row.status === "in_progress",
  ).length;

  const upcomingLeaseExpirations: LandlordPortalUpcomingLease[] = (
    (leases as Array<{
      lease_id: string;
      unit_id: string;
      lessee_id: string;
      end_date: string;
      status: string;
    }> | null) ?? []
  )
    .filter(
      (row) =>
        row.status === "active" &&
        row.end_date >= todayIso &&
        row.end_date <= horizon90,
    )
    .map((row) => {
      const unit = maps.unitById.get(row.unit_id);
      return {
        leaseId: row.lease_id,
        lesseeName: maps.lesseeNameById.get(row.lessee_id) ?? "—",
        unitLabel: unit
          ? `${propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
          : "—",
        endDate: row.end_date,
        daysUntilEnd: daysBetweenIso(todayIso, row.end_date),
      };
    })
    .sort((a, b) => a.endDate.localeCompare(b.endDate))
    .slice(0, 12);

  const rentCollectionTrend: LandlordPortalRentTrendPoint[] = trendKeys.map(
    (monthKey) => {
      const point = trendMap.get(monthKey) ?? { collectedGhs: 0, dueGhs: 0 };
      return {
        label: formatMonthTrendLabel(monthKey),
        monthKey,
        collectedGhs: point.collectedGhs,
        dueGhs: point.dueGhs,
      };
    },
  );

  const recentActivity = activity
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 8);

  const revenueEntries: Array<{ date: string; amount: number }> = [];
  for (const row of (rentRows as Array<{
    amount_paid_ghs: number | string;
    payment_date: string | null;
  }> | null) ?? []) {
    if (!row.payment_date) continue;
    const amountPaid = Number(row.amount_paid_ghs) || 0;
    if (amountPaid <= 0) continue;
    revenueEntries.push({ date: row.payment_date, amount: amountPaid });
  }

  const expenseEntries = (
    (expenses as Array<{
      amount_ghs: number | string;
      expense_date: string;
    }> | null) ?? []
  ).map((row) => ({
    date: row.expense_date,
    amount: Number(row.amount_ghs) || 0,
  }));

  const financialSummary = buildLandlordPortalFinancialSummary({
    revenueEntries,
    expenseEntries,
  });

  return {
    data: {
      occupiedUnits,
      totalUnits,
      vacantUnits,
      occupancyRatePct,
      rentCollectedThisMonthGhs,
      outstandingBalanceGhs,
      openMaintenanceCount,
      openComplaintsCount,
      arrearsBuckets,
      upcomingLeaseExpirations,
      rentCollectionTrend,
      expensesThisMonthGhs,
      netIncomeThisMonthGhs:
        rentCollectedThisMonthGhs - expensesThisMonthGhs,
      recentActivity,
      financialSummary,
    },
    error: null,
  };
}

export async function fetchLandlordPortalProperties(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalPropertyBrowseRow[]; error: string | null }> {
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

  const admin = createAdminClient();
  const [{ data: properties, error }, { data: units }] = await Promise.all([
    admin
      .from("properties")
      .select(
        "property_id, name, property_type, city, region, address_line1",
      )
      .eq("tenant_id", session.tenantId)
      .order("name", { ascending: true }),
    admin
      .from("property_units")
      .select("property_id, status")
      .eq("tenant_id", session.tenantId),
  ]);

  if (error) return { rows: [], error: error.message };

  const stats = new Map<string, { total: number; occupied: number }>();
  for (const unit of (units as Array<{
    property_id: string;
    status: string;
  }> | null) ?? []) {
    const current = stats.get(unit.property_id) ?? { total: 0, occupied: 0 };
    current.total += 1;
    if (unit.status === "occupied") current.occupied += 1;
    stats.set(unit.property_id, current);
  }

  const rows: LandlordPortalPropertyBrowseRow[] = (
    (properties as Array<{
      property_id: string;
      name: string;
      property_type: string | null;
      city: string | null;
      region: string | null;
      address_line1: string | null;
    }> | null) ?? []
  ).map((row) => {
    const s = stats.get(row.property_id) ?? { total: 0, occupied: 0 };
    return {
      propertyId: row.property_id,
      name: row.name,
      propertyType: row.property_type,
      city: row.city,
      region: row.region,
      addressLine1: row.address_line1,
      unitCount: s.total,
      occupiedCount: s.occupied,
    };
  });

  return { rows, error: null };
}

export async function fetchLandlordPortalUnits(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalUnitBrowseRow[]; error: string | null }> {
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

  const admin = createAdminClient();
  const [{ data: units, error }, { data: properties }] = await Promise.all([
    admin
      .from("property_units")
      .select(
        "unit_id, property_id, unit_number, bedrooms, bathrooms, base_rent_ghs, status",
      )
      .eq("tenant_id", session.tenantId)
      .order("unit_number", { ascending: true }),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", session.tenantId),
  ]);

  if (error) return { rows: [], error: error.message };

  const propertyNameById = new Map(
    ((properties as Array<{ property_id: string; name: string }> | null) ?? []).map(
      (row) => [row.property_id, row.name],
    ),
  );

  const rows: LandlordPortalUnitBrowseRow[] = (
    (units as Array<{
      unit_id: string;
      property_id: string;
      unit_number: string;
      bedrooms: number | null;
      bathrooms: number | null;
      base_rent_ghs: number | string;
      status: string;
    }> | null) ?? []
  ).map((row) => ({
    unitId: row.unit_id,
    propertyId: row.property_id,
    propertyName: propertyNameById.get(row.property_id) ?? "—",
    unitNumber: row.unit_number,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    baseRentGhs: Number(row.base_rent_ghs) || 0,
    status: row.status,
  }));

  return { rows, error: null };
}

export async function fetchLandlordPortalTenants(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalTenantBrowseRow[]; error: string | null }> {
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("lessees")
    .select("lessee_id, full_name, phone, email, status")
    .eq("tenant_id", session.tenantId)
    .order("full_name", { ascending: true });

  if (error) return { rows: [], error: error.message };

  const rows: LandlordPortalTenantBrowseRow[] = (
    (data as Array<{
      lessee_id: string;
      full_name: string;
      phone: string | null;
      email: string | null;
      status: string | null;
    }> | null) ?? []
  ).map((row) => ({
    lesseeId: row.lessee_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
  }));

  return { rows, error: null };
}

export async function fetchLandlordPortalLeasesBrowse(
  session: LandlordPortalSession,
): Promise<{ rows: LandlordPortalLeaseBrowseRow[]; error: string | null }> {
  const { data, error } = await fetchLandlordPortalDashboardData(session);
  if (error) return { rows: [], error };
  return { rows: data?.leases ?? [], error: null };
}

export async function fetchLandlordPortalRentLedgerBrowse(
  session: LandlordPortalSession,
  options: { activeLeasesOnly?: boolean } = {},
): Promise<{ rows: LandlordPortalRentLedgerBrowseRow[]; error: string | null }> {
  const activeLeasesOnly = options.activeLeasesOnly !== false;
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const [
    { data: rentRows, error: rentError },
    { data: leases },
    { data: units },
    { data: properties },
    { data: lessees },
  ] = await Promise.all([
    admin
      .from("rent_ledger")
      .select(
        "entry_id, lease_id, charge_type, description, period_start, period_end, status, amount_due_ghs, amount_paid_ghs, credit_ghs, payment_date, payment_method, notes",
      )
      .eq("tenant_id", tenantId)
      .order("period_start", { ascending: false })
      .limit(200),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id, status")
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

  if (rentError) return { rows: [], error: rentError.message };

  const maps = buildLookupMaps(leases, units, properties, lessees);
  const rows: LandlordPortalRentLedgerBrowseRow[] = [];

  for (const row of (rentRows as Array<{
    entry_id: string;
    lease_id: string;
    charge_type?: string | null;
    description?: string | null;
    period_start: string;
    period_end: string;
    status: string;
    amount_due_ghs: number | string;
    amount_paid_ghs: number | string;
    credit_ghs?: number | string | null;
    payment_date: string | null;
    payment_method: string | null;
    notes: string | null;
  }> | null) ?? []) {
    if (
      activeLeasesOnly &&
      !isActiveLeaseStatus(maps.leaseStatusById.get(row.lease_id))
    ) {
      continue;
    }

    const amountDue = Number(row.amount_due_ghs) || 0;
    const amountPaid = Number(row.amount_paid_ghs) || 0;
    const creditGhs = Number(row.credit_ghs) || 0;
    const outstanding = rentOutstandingGhs(amountDue, amountPaid, creditGhs);
    const lease = maps.leaseById.get(row.lease_id);
    const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;
    rows.push({
      entryId: row.entry_id,
      leaseId: row.lease_id,
      lesseeName: lease
        ? (maps.lesseeNameById.get(lease.lessee_id) ?? "—")
        : "—",
      unitLabel: unit
        ? `${maps.propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
        : "—",
      chargeType: row.charge_type === "one_time" ? "one_time" : "rent",
      description: row.description?.trim() || null,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      amountDueGhs: amountDue,
      amountPaidGhs: amountPaid,
      creditGhs,
      outstandingGhs: outstanding,
      status: row.status,
      statusLabel: formatRentLedgerStatus(row.status as RentLedgerStatus),
      paymentDate: row.payment_date,
      paymentMethod: row.payment_method,
      notes: row.notes,
    });
  }

  return { rows, error: null };
}

export async function fetchLandlordPortalRentLedgerEntry(
  session: LandlordPortalSession,
  entryId: string,
): Promise<{
  row: LandlordPortalRentLedgerBrowseRow | null;
  error: string | null;
}> {
  if (!landlordPortalHasDataAccess(session)) {
    return { row: null, error: null };
  }

  const trimmed = entryId.trim();
  if (!trimmed) {
    return { row: null, error: "entry_id is required" };
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;
  const { data: rentRow, error: rentError } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, lease_id, charge_type, description, period_start, period_end, status, amount_due_ghs, amount_paid_ghs, credit_ghs, payment_date, payment_method, notes",
    )
    .eq("tenant_id", tenantId)
    .eq("entry_id", trimmed)
    .maybeSingle();

  if (rentError) return { row: null, error: rentError.message };
  if (!rentRow) return { row: null, error: null };

  const [{ data: leases }, { data: units }, { data: properties }, { data: lessees }] =
    await Promise.all([
      admin
        .from("leases")
        .select("lease_id, unit_id, lessee_id")
        .eq("tenant_id", tenantId)
        .eq("lease_id", rentRow.lease_id),
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

  const maps = buildLookupMaps(leases, units, properties, lessees);
  const amountDue = Number(rentRow.amount_due_ghs) || 0;
  const amountPaid = Number(rentRow.amount_paid_ghs) || 0;
  const creditGhs = Number(rentRow.credit_ghs) || 0;
  const lease = maps.leaseById.get(rentRow.lease_id);
  const unit = lease ? maps.unitById.get(lease.unit_id) : undefined;

  return {
    row: {
      entryId: rentRow.entry_id,
      leaseId: rentRow.lease_id,
      lesseeName: lease
        ? (maps.lesseeNameById.get(lease.lessee_id) ?? "—")
        : "—",
      unitLabel: unit
        ? `${maps.propertyNameById.get(unit.property_id) ?? "—"} · ${unit.unit_number}`
        : "—",
      chargeType: rentRow.charge_type === "one_time" ? "one_time" : "rent",
      description:
        typeof rentRow.description === "string"
          ? rentRow.description.trim() || null
          : null,
      periodStart: rentRow.period_start,
      periodEnd: rentRow.period_end,
      amountDueGhs: amountDue,
      amountPaidGhs: amountPaid,
      creditGhs,
      outstandingGhs: rentOutstandingGhs(amountDue, amountPaid, creditGhs),
      status: rentRow.status,
      statusLabel: formatRentLedgerStatus(rentRow.status as RentLedgerStatus),
      paymentDate: rentRow.payment_date,
      paymentMethod: rentRow.payment_method,
      notes: rentRow.notes,
    },
    error: null,
  };
}

export async function fetchLandlordPortalExpenses(
  session: LandlordPortalSession,
): Promise<{
  rows: LandlordPortalExpenseBrowseRow[];
  properties: Array<{ propertyId: string; name: string }>;
  error: string | null;
}> {
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], properties: [], error: null };
  }

  const admin = createAdminClient();
  const [{ data: expenses, error }, { data: properties }] = await Promise.all([
    admin
      .from("property_expenses")
      .select(
        "expense_id, property_id, category, amount_ghs, expense_date, description, receipt_url",
      )
      .eq("tenant_id", session.tenantId)
      .order("expense_date", { ascending: false })
      .limit(200),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", session.tenantId)
      .order("name", { ascending: true }),
  ]);

  if (error) return { rows: [], properties: [], error: error.message };

  const propertyNameById = new Map(
    ((properties as Array<{ property_id: string; name: string }> | null) ?? []).map(
      (row) => [row.property_id, row.name],
    ),
  );

  const propertyOptions = (
    (properties as Array<{ property_id: string; name: string }> | null) ?? []
  ).map((row) => ({ propertyId: row.property_id, name: row.name }));

  const rows: LandlordPortalExpenseBrowseRow[] = (
    (expenses as Array<{
      expense_id: string;
      property_id: string;
      category: string;
      amount_ghs: number | string;
      expense_date: string;
      description: string | null;
      receipt_url: string | null;
    }> | null) ?? []
  ).map((row) => ({
    expenseId: row.expense_id,
    propertyId: row.property_id,
    propertyName: propertyNameById.get(row.property_id) ?? "—",
    category: row.category,
    amountGhs: Number(row.amount_ghs) || 0,
    expenseDate: row.expense_date,
    description: row.description,
    receiptUrl: row.receipt_url,
  }));

  return { rows, properties: propertyOptions, error: null };
}

export async function fetchLandlordPortalWorkspaceProfile(
  session: LandlordPortalSession,
): Promise<{
  data: LandlordPortalWorkspaceProfile | null;
  error: string | null;
}> {
  if (!landlordPortalHasDataAccess(session)) {
    return { data: null, error: null };
  }

  const admin = createAdminClient();
  const [tenantResult, landlordResult] = await Promise.all([
    admin
      .from("tenants")
      .select("name, email, phone, address")
      .eq("id", session.tenantId)
      .maybeSingle(),
    admin
      .from("landlords")
      .select("notification_phone, logo_url")
      .eq("tenant_id", session.tenantId)
      .maybeSingle(),
  ]);

  if (tenantResult.error) {
    return { data: null, error: tenantResult.error.message };
  }
  if (landlordResult.error) {
    return { data: null, error: landlordResult.error.message };
  }
  if (!tenantResult.data) {
    return { data: null, error: "Workspace profile not found." };
  }

  const data = tenantResult.data;
  const notificationPhone =
    typeof landlordResult.data?.notification_phone === "string"
      ? landlordResult.data.notification_phone
      : null;
  const tenantPhone = typeof data.phone === "string" ? data.phone : null;

  return {
    data: {
      name: typeof data.name === "string" ? data.name : session.fullName,
      email: typeof data.email === "string" ? data.email : session.email,
      // Prefer notification_phone when set; columns should stay equal after saves.
      phone: notificationPhone ?? tenantPhone,
      address: typeof data.address === "string" ? data.address : null,
      logoUrl:
        typeof landlordResult.data?.logo_url === "string" &&
        landlordResult.data.logo_url.trim()
          ? landlordResult.data.logo_url.trim()
          : null,
    },
    error: null,
  };
}

export async function fetchLandlordPortalBillingSnapshot(
  session: LandlordPortalSession,
): Promise<{
  data: LandlordPortalBillingSnapshot | null;
  error: string | null;
}> {
  if (!landlordPortalHasDataAccess(session)) {
    return { data: null, error: null };
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;

  const [
    subscriptionResult,
    packsResult,
    walletResult,
    tenantResult,
  ] = await Promise.all([
    admin
      .from("landlord_subscriptions")
      .select("tier, status, trial_ends_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("sms_credit_packs")
      .select("pack_key, credits, price_ghs, is_active")
      .eq("is_active", true)
      .order("credits", { ascending: true }),
    admin
      .from("sms_credit_wallets")
      .select("balance")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("email")
      .eq("id", tenantId)
      .maybeSingle(),
  ]);

  // landlord_subscriptions may be absent for some tenants; treat lookup
  // errors as "no plan" rather than blocking SMS purchase.
  const subscriptionError = subscriptionResult.error?.message ?? null;
  const fetchError =
    packsResult.error?.message ??
    walletResult.error?.message ??
    tenantResult.error?.message ??
    null;

  const subscription =
    !subscriptionError && subscriptionResult.data
      ? (subscriptionResult.data as {
          tier: string | null;
          status: string | null;
          trial_ends_at: string | null;
        })
      : null;

  const smsCreditPacks: LandlordPortalSmsCreditPack[] = (
    (packsResult.data as
      | Array<{
          pack_key: string;
          credits: number;
          price_ghs: number;
          is_active: boolean;
        }>
      | null) ?? []
  ).map((pack) => ({
    packKey: pack.pack_key,
    credits: Number(pack.credits) || 0,
    priceGhs: Number(pack.price_ghs) || 0,
    isActive: pack.is_active !== false,
  }));

  const billingEmail =
    (typeof tenantResult.data?.email === "string"
      ? tenantResult.data.email.trim()
      : "") ||
    (session.email?.trim() ?? "") ||
    null;

  return {
    data: {
      subscriptionTier:
        session.landlordType === "platform_only"
          ? (subscription?.tier ?? null)
          : null,
      subscriptionStatus:
        session.landlordType === "platform_only"
          ? (subscription?.status ?? null)
          : null,
      trialEndsAt:
        session.landlordType === "platform_only"
          ? (subscription?.trial_ends_at ?? null)
          : null,
      smsCreditBalance:
        walletResult.data?.balance != null
          ? Number(walletResult.data.balance) || 0
          : 0,
      smsCreditPacks,
      billingEmail,
    },
    error: fetchError,
  };
}

export async function fetchLandlordPortalLesseeAccounts(
  session: LandlordPortalSession,
): Promise<{
  rows: LandlordPortalLesseeAccountRow[];
  error: string | null;
}> {
  if (!landlordPortalHasDataAccess(session)) {
    return { rows: [], error: null };
  }

  const admin = createAdminClient();
  const tenantId = session.tenantId;
  const nowIso = new Date().toISOString();
  const canMutatePortalAccounts = session.landlordType === "platform_only";

  const [
    { data: lessees, error: lesseesError },
    { data: invites, error: invitesError },
    { data: leases, error: leasesError },
  ] = await Promise.all([
    admin
      .from("lessees")
      .select("lessee_id, full_name, email, phone, auth_user_id")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true }),
    admin
      .from("lessee_portal_invites")
      .select("lessee_id, expires_at, used_at")
      .eq("tenant_id", tenantId)
      .is("used_at", null)
      .gt("expires_at", nowIso),
    admin
      .from("leases")
      .select("lease_id, lessee_id, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  ]);

  if (lesseesError) {
    return { rows: [], error: lesseesError.message };
  }
  if (invitesError) {
    return { rows: [], error: invitesError.message };
  }
  if (leasesError) {
    return { rows: [], error: leasesError.message };
  }

  const pendingInviteByLessee = new Map<string, string>();
  for (const invite of (invites as Array<{
    lessee_id: string;
    expires_at: string;
    used_at: string | null;
  }> | null) ?? []) {
    const existing = pendingInviteByLessee.get(invite.lessee_id);
    if (!existing || invite.expires_at > existing) {
      pendingInviteByLessee.set(invite.lessee_id, invite.expires_at);
    }
  }

  const leaseIdByLessee = new Map<string, string>();
  const hasActiveLease = new Set<string>();
  for (const lease of (leases as Array<{
    lease_id: string;
    lessee_id: string;
    status: string;
  }> | null) ?? []) {
    if (!leaseIdByLessee.has(lease.lessee_id)) {
      // Rows are newest-first — first seen is the fallback lease.
      leaseIdByLessee.set(lease.lessee_id, lease.lease_id);
    }
    if (lease.status === "active" && !hasActiveLease.has(lease.lessee_id)) {
      leaseIdByLessee.set(lease.lessee_id, lease.lease_id);
      hasActiveLease.add(lease.lessee_id);
    }
  }

  const lesseeRows =
    (lessees as Array<{
      lessee_id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      auth_user_id: string | null;
    }> | null) ?? [];

  const banChecks = await Promise.all(
    lesseeRows.map(async (lessee) => {
      const authUserId =
        typeof lessee.auth_user_id === "string"
          ? lessee.auth_user_id.trim()
          : "";
      if (!authUserId) {
        return { lesseeId: lessee.lessee_id, banned: false };
      }
      const { data, error } = await admin.auth.admin.getUserById(authUserId);
      if (error || !data.user) {
        return { lesseeId: lessee.lessee_id, banned: false };
      }
      const bannedUntil =
        (data.user as { banned_until?: string | null }).banned_until ?? null;
      return {
        lesseeId: lessee.lessee_id,
        banned: isAuthUserBanned(bannedUntil),
      };
    }),
  );
  const bannedByLessee = new Map(
    banChecks.map((row) => [row.lesseeId, row.banned]),
  );

  const rows: LandlordPortalLesseeAccountRow[] = lesseeRows.map((lessee) => {
    const email =
      typeof lessee.email === "string" ? lessee.email.trim() || null : null;
    const hasAuth = Boolean(
      typeof lessee.auth_user_id === "string" && lessee.auth_user_id.trim(),
    );
    const inviteExpiresAt = pendingInviteByLessee.get(lessee.lessee_id) ?? null;
    const isDisabled = Boolean(bannedByLessee.get(lessee.lessee_id));

    let portalStatus: LandlordPortalLesseeAccountPortalStatus = "no_account";
    if (hasAuth && isDisabled) {
      portalStatus = "disabled";
    } else if (hasAuth) {
      portalStatus = "active";
    } else if (inviteExpiresAt) {
      portalStatus = "pending_invite";
    }

    return {
      lesseeId: lessee.lessee_id,
      fullName: lessee.full_name,
      email,
      phone: typeof lessee.phone === "string" ? lessee.phone : null,
      portalStatus,
      inviteExpiresAt,
      leaseId: leaseIdByLessee.get(lessee.lessee_id) ?? null,
      canResendInvite: !hasAuth && Boolean(email),
      canDeactivate:
        canMutatePortalAccounts && hasAuth && portalStatus === "active",
      canReactivate:
        canMutatePortalAccounts && hasAuth && portalStatus === "disabled",
      canResetPassword:
        canMutatePortalAccounts && hasAuth && portalStatus === "active",
    };
  });

  return { rows, error: null };
}
