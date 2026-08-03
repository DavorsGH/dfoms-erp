import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  isDepositStatus,
  isLateFeeType,
  isLeaseStatus,
  isRentChangeStatus,
  isSignatureStatus,
  isTerminationRequestStatus,
  type DepositStatus,
  type LateFeeType,
  type LeaseDetail,
  type LeaseListRow,
  type LeaseStatus,
  type LesseeOption,
  type RentChangeStatus,
  type SecurityDepositRecord,
  type SignatureStatus,
  type TerminationRequestStatus,
  type VacantUnitOption,
} from "@/app/dashboard/real-estate/leases-utils";

export type {
  LeaseDetail,
  LeaseListRow,
  LesseeOption,
  VacantUnitOption,
} from "@/app/dashboard/real-estate/leases-utils";

type LeaseRow = {
  tenant_id: string;
  lease_id: string;
  unit_id: string;
  lessee_id: string;
  start_date: string;
  end_date: string;
  rent_amount_ghs: number | string;
  advance_rent_amount_ghs: number | string | null;
  termination_notice_months: number | null;
  pending_rent_amount_ghs: number | string | null;
  rent_change_status: string | null;
  pending_termination_reason: string | null;
  termination_request_status: string | null;
  escalation_percent: number | string | null;
  escalation_frequency_months: number | null;
  late_fee_enabled: boolean;
  late_fee_type: string | null;
  late_fee_amount: number | string | null;
  status: string;
  terminated_at: string | null;
  termination_reason: string | null;
  signature_status: string | null;
  lease_document_url: string | null;
  landlord_acknowledged_at: string | null;
  tenant_acknowledged_at: string | null;
  landlord_acknowledged_by: string | null;
  tenant_acknowledged_by: string | null;
  created_at: string;
  updated_at: string;
};

function composePropertyAddress(parts: {
  propertyName: string;
  unitNumber: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
}): string {
  const street = [parts.addressLine1, parts.addressLine2]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
  const locality = [parts.city, parts.region]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
  const unitLabel =
    parts.unitNumber && parts.unitNumber !== "—"
      ? `Unit ${parts.unitNumber}`
      : null;
  const head = [parts.propertyName !== "—" ? parts.propertyName : null, unitLabel]
    .filter(Boolean)
    .join(" · ");
  return [head, street, locality].filter(Boolean).join(", ") || "—";
}

function composePropertyLocation(
  city: string | null,
  region: string | null,
  propertyName: string,
): string {
  const locality = [city, region]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(", ");
  if (locality) {
    return locality;
  }
  return propertyName !== "—" ? propertyName : "—";
}

type DepositRow = {
  tenant_id: string;
  deposit_id: string;
  lease_id: string;
  amount_ghs: number | string;
  status: string;
  amount_returned_ghs: number | string | null;
  date_collected: string;
  date_resolved: string | null;
  resolution_notes: string | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapDeposit(row: DepositRow): SecurityDepositRecord | null {
  if (!isDepositStatus(row.status)) {
    return null;
  }

  return {
    depositId: row.deposit_id,
    tenantId: row.tenant_id,
    leaseId: row.lease_id,
    amountGhs: toNumber(row.amount_ghs) ?? 0,
    status: row.status as DepositStatus,
    amountReturnedGhs: toNumber(row.amount_returned_ghs),
    dateCollected: row.date_collected,
    dateResolved: row.date_resolved,
    resolutionNotes: row.resolution_notes,
  };
}

export async function fetchVacantUnitsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ units: VacantUnitOption[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { units: [], fetchError: landlord.error };
  }

  const [
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
  ] = await Promise.all([
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id, base_rent_ghs")
      .eq("tenant_id", landlord.tenantId)
      .eq("status", "vacant")
      .order("unit_number", { ascending: true }),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", landlord.tenantId),
  ]);

  if (unitsError) {
    return { units: [], fetchError: unitsError.message };
  }
  if (propertiesError) {
    return { units: [], fetchError: propertiesError.message };
  }

  const propertyNameById = new Map(
    ((properties as Array<{ property_id: string; name: string }> | null) ?? []).map(
      (row) => [row.property_id, row.name],
    ),
  );

  const options: VacantUnitOption[] = (
    (units as Array<{
      unit_id: string;
      unit_number: string;
      property_id: string;
      base_rent_ghs: number | string;
    }> | null) ?? []
  ).map((row) => ({
    unitId: row.unit_id,
    unitNumber: row.unit_number,
    propertyId: row.property_id,
    propertyName: propertyNameById.get(row.property_id) ?? "Property",
    baseRentGhs: toNumber(row.base_rent_ghs) ?? 0,
  }));

  return { units: options, fetchError: null };
}

export async function fetchLesseeOptionsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ lessees: LesseeOption[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { lessees: [], fetchError: landlord.error };
  }

  const { data, error } = await admin
    .from("lessees")
    .select("lessee_id, full_name, phone, email, status")
    .eq("tenant_id", landlord.tenantId)
    .order("full_name", { ascending: true });

  if (error) {
    return { lessees: [], fetchError: error.message };
  }

  const lessees: LesseeOption[] = (
    (data as Array<{
      lessee_id: string;
      full_name: string;
      phone: string;
      email: string | null;
      status: string;
    }> | null) ?? []
  ).map((row) => ({
    lesseeId: row.lessee_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
  }));

  return { lessees, fetchError: null };
}

export async function fetchLeasesForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: LeaseListRow[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const [
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("leases")
      .select(
        "tenant_id, lease_id, unit_id, lessee_id, start_date, end_date, rent_amount_ghs, status, created_at",
      )
      .eq("tenant_id", landlord.tenantId)
      .order("created_at", { ascending: false }),
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", landlord.tenantId),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", landlord.tenantId),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", landlord.tenantId),
  ]);

  if (leasesError) {
    return { rows: [], fetchError: leasesError.message };
  }
  if (unitsError) {
    return { rows: [], fetchError: unitsError.message };
  }
  if (propertiesError) {
    return { rows: [], fetchError: propertiesError.message };
  }
  if (lesseesError) {
    return { rows: [], fetchError: lesseesError.message };
  }

  const propertyNameById = new Map(
    ((properties as Array<{ property_id: string; name: string }> | null) ?? []).map(
      (row) => [row.property_id, row.name],
    ),
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
  const lesseeNameById = new Map(
    ((lessees as Array<{ lessee_id: string; full_name: string }> | null) ?? []).map(
      (row) => [row.lessee_id, row.full_name],
    ),
  );

  const rows: LeaseListRow[] = [];
  for (const row of (leases as LeaseRow[] | null) ?? []) {
    if (!isLeaseStatus(row.status)) {
      continue;
    }
    const unit = unitById.get(row.unit_id);
    rows.push({
      leaseId: row.lease_id,
      tenantId: row.tenant_id,
      unitId: row.unit_id,
      unitNumber: unit?.unit_number ?? "—",
      propertyName: unit
        ? (propertyNameById.get(unit.property_id) ?? "—")
        : "—",
      lesseeId: row.lessee_id,
      lesseeName: lesseeNameById.get(row.lessee_id) ?? "—",
      startDate: row.start_date,
      endDate: row.end_date,
      rentAmountGhs: toNumber(row.rent_amount_ghs) ?? 0,
      status: row.status as LeaseStatus,
    });
  }

  return { rows, fetchError: null };
}

export async function fetchLeaseDetail(
  admin: SupabaseClient,
  tenantId: string,
  leaseId: string,
): Promise<{ detail: LeaseDetail | null; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { detail: null, fetchError: landlord.error };
  }

  const trimmedLeaseId = leaseId.trim();
  if (!trimmedLeaseId) {
    return { detail: null, fetchError: "lease_id is required" };
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("*")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", trimmedLeaseId)
    .maybeSingle();

  if (leaseError) {
    return { detail: null, fetchError: leaseError.message };
  }
  if (!lease) {
    return { detail: null, fetchError: null };
  }

  const leaseRow = lease as LeaseRow;
  if (!isLeaseStatus(leaseRow.status)) {
    return { detail: null, fetchError: "Invalid lease status on record." };
  }

  const [
    { data: unit, error: unitError },
    { data: lessee, error: lesseeError },
    { data: deposits, error: depositsError },
  ] = await Promise.all([
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", landlord.tenantId)
      .eq("unit_id", leaseRow.unit_id)
      .maybeSingle(),
    admin
      .from("lessees")
      .select("lessee_id, full_name, phone, email")
      .eq("tenant_id", landlord.tenantId)
      .eq("lessee_id", leaseRow.lessee_id)
      .maybeSingle(),
    admin
      .from("security_deposits")
      .select("*")
      .eq("tenant_id", landlord.tenantId)
      .eq("lease_id", trimmedLeaseId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (unitError) {
    return { detail: null, fetchError: unitError.message };
  }
  if (lesseeError) {
    return { detail: null, fetchError: lesseeError.message };
  }
  if (depositsError) {
    return { detail: null, fetchError: depositsError.message };
  }

  let propertyName = "—";
  let propertyAddressLine1: string | null = null;
  let propertyAddressLine2: string | null = null;
  let propertyCity: string | null = null;
  let propertyRegion: string | null = null;
  if (unit?.property_id) {
    const { data: property } = await admin
      .from("properties")
      .select("name, address_line1, address_line2, city, region")
      .eq("tenant_id", landlord.tenantId)
      .eq("property_id", unit.property_id)
      .maybeSingle();
    propertyName = (property?.name as string | undefined) ?? "—";
    propertyAddressLine1 =
      (property?.address_line1 as string | null | undefined) ?? null;
    propertyAddressLine2 =
      (property?.address_line2 as string | null | undefined) ?? null;
    propertyCity = (property?.city as string | null | undefined) ?? null;
    propertyRegion = (property?.region as string | null | undefined) ?? null;
  }

  const [{ data: landlordContact }, { data: landlordRow }] = await Promise.all([
    admin
      .from("tenants")
      .select("address, phone")
      .eq("id", landlord.tenantId)
      .maybeSingle(),
    admin
      .from("landlords")
      .select("notification_phone")
      .eq("tenant_id", landlord.tenantId)
      .maybeSingle(),
  ]);

  const unitNumber = (unit?.unit_number as string | undefined) ?? "—";
  const propertyAddress = composePropertyAddress({
    propertyName,
    unitNumber,
    addressLine1: propertyAddressLine1,
    addressLine2: propertyAddressLine2,
    city: propertyCity,
    region: propertyRegion,
  });
  const propertyLocation = composePropertyLocation(
    propertyCity,
    propertyRegion,
    propertyName,
  );
  const tenantPhone =
    typeof landlordContact?.phone === "string"
      ? landlordContact.phone.trim() || null
      : null;
  const notificationPhone =
    typeof landlordRow?.notification_phone === "string"
      ? landlordRow.notification_phone.trim() || null
      : null;

  const depositRow = ((deposits as DepositRow[] | null) ?? [])[0] ?? null;
  const deposit = depositRow ? mapDeposit(depositRow) : null;

  let rentChangeStatus: RentChangeStatus | null = null;
  if (
    leaseRow.rent_change_status &&
    isRentChangeStatus(leaseRow.rent_change_status)
  ) {
    rentChangeStatus = leaseRow.rent_change_status;
  }

  let terminationRequestStatus: TerminationRequestStatus | null = null;
  if (
    leaseRow.termination_request_status &&
    isTerminationRequestStatus(leaseRow.termination_request_status)
  ) {
    terminationRequestStatus = leaseRow.termination_request_status;
  }

  let lateFeeType: LateFeeType | null = null;
  if (leaseRow.late_fee_type && isLateFeeType(leaseRow.late_fee_type)) {
    lateFeeType = leaseRow.late_fee_type;
  }

  let signatureStatus: SignatureStatus = "unsigned";
  if (
    leaseRow.signature_status &&
    isSignatureStatus(leaseRow.signature_status)
  ) {
    signatureStatus = leaseRow.signature_status;
  }

  const leaseDocumentUrl =
    typeof leaseRow.lease_document_url === "string" &&
    leaseRow.lease_document_url.trim()
      ? leaseRow.lease_document_url.trim()
      : null;

  return {
    detail: {
      leaseId: leaseRow.lease_id,
      tenantId: leaseRow.tenant_id,
      landlordName: landlord.name,
      landlordAddress:
        typeof landlordContact?.address === "string"
          ? landlordContact.address.trim() || null
          : null,
      // Prefer landlords.notification_phone (workspace pattern); else tenants.phone.
      landlordPhone: notificationPhone ?? tenantPhone,
      unitId: leaseRow.unit_id,
      unitNumber,
      propertyName,
      propertyAddress,
      propertyLocation,
      lesseeId: leaseRow.lessee_id,
      lesseeName: (lessee?.full_name as string | undefined) ?? "—",
      lesseePhone: (lessee?.phone as string | undefined) ?? "—",
      lesseeEmail: (lessee?.email as string | null | undefined) ?? null,
      startDate: leaseRow.start_date,
      endDate: leaseRow.end_date,
      rentAmountGhs: toNumber(leaseRow.rent_amount_ghs) ?? 0,
      advanceRentAmountGhs: toNumber(leaseRow.advance_rent_amount_ghs) ?? 0,
      terminationNoticeMonths:
        typeof leaseRow.termination_notice_months === "number" &&
        Number.isInteger(leaseRow.termination_notice_months) &&
        leaseRow.termination_notice_months >= 1
          ? leaseRow.termination_notice_months
          : 3,
      pendingRentAmountGhs: toNumber(leaseRow.pending_rent_amount_ghs),
      rentChangeStatus,
      pendingTerminationReason:
        leaseRow.pending_termination_reason?.trim() || null,
      terminationRequestStatus,
      escalationPercent: toNumber(leaseRow.escalation_percent),
      escalationFrequencyMonths: leaseRow.escalation_frequency_months,
      lateFeeEnabled: Boolean(leaseRow.late_fee_enabled),
      lateFeeType,
      lateFeeAmount: toNumber(leaseRow.late_fee_amount),
      status: leaseRow.status,
      terminatedAt: leaseRow.terminated_at,
      terminationReason: leaseRow.termination_reason,
      signatureStatus,
      leaseDocumentUrl,
      landlordAcknowledgedAt: leaseRow.landlord_acknowledged_at ?? null,
      tenantAcknowledgedAt: leaseRow.tenant_acknowledged_at ?? null,
      landlordAcknowledgedBy: leaseRow.landlord_acknowledged_by ?? null,
      tenantAcknowledgedBy: leaseRow.tenant_acknowledged_by ?? null,
      createdAt: leaseRow.created_at,
      updatedAt: leaseRow.updated_at,
      deposit,
    },
    fetchError: null,
  };
}

/**
 * Shared early-termination effect used by staff Terminate Lease Early and by
 * approving a tenant termination request. Frees the unit; deposit is returned
 * as deposit_id for the existing resolve-deposit UI (not auto-resolved).
 */
export async function terminateLeaseEarly(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    leaseId: string;
    terminationReason: string;
    /** When true, stamp termination_request_status = approved (tenant request path). */
    markRequestApproved?: boolean;
  },
): Promise<{ depositId: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, options.tenantId);
  if (!landlord.ok) {
    throw new Error(landlord.error);
  }

  const leaseId = options.leaseId.trim();
  const terminationReason = options.terminationReason.trim();
  if (!leaseId) {
    throw new Error("lease_id is required");
  }
  if (!terminationReason) {
    throw new Error("termination_reason is required");
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, unit_id, status")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    throw new Error(leaseError.message);
  }
  if (!lease) {
    throw new Error("Lease not found.");
  }
  if (lease.status !== "active") {
    throw new Error("Only active leases can be terminated early.");
  }

  const now = new Date().toISOString();

  const { error: updateError } = await admin
    .from("leases")
    .update({
      status: "terminated_early",
      terminated_at: now,
      termination_reason: terminationReason,
      pending_termination_reason: null,
      termination_request_status: options.markRequestApproved
        ? "approved"
        : null,
      updated_at: now,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId);

  if (updateError) {
    throw new Error(updateError.message);
  }

  const { error: unitError } = await admin
    .from("property_units")
    .update({
      status: "vacant",
      updated_at: now,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("unit_id", lease.unit_id);

  if (unitError) {
    throw new Error(unitError.message);
  }

  const { data: deposit } = await admin
    .from("security_deposits")
    .select("deposit_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return { depositId: deposit?.deposit_id ?? null };
}
