import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  isRentLedgerStatus,
  isRentVerificationStatus,
  type RentLedgerListRow,
  type RentLedgerStatus,
  type RentVerificationStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";

export type { RentLedgerListRow } from "@/app/dashboard/real-estate/rent-ledger-utils";

type LedgerRow = {
  tenant_id: string;
  entry_id: string;
  lease_id: string;
  charge_type?: string | null;
  description?: string | null;
  period_start: string;
  period_end: string;
  amount_due_ghs: number | string;
  amount_paid_ghs: number | string;
  credit_ghs?: number | string | null;
  payment_method: string | null;
  payment_date: string | null;
  status: string;
  verification_status: string;
  notes: string | null;
};

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchLandlordTypeForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ landlordType: LandlordType | null; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { landlordType: null, fetchError: landlord.error };
  }

  const { data, error } = await admin
    .from("landlords")
    .select("landlord_type")
    .eq("tenant_id", landlord.tenantId)
    .maybeSingle();

  if (error) {
    return { landlordType: null, fetchError: error.message };
  }

  const type = data?.landlord_type;
  if (type === "platform_only" || type === "davors_managed") {
    return { landlordType: type, fetchError: null };
  }

  return { landlordType: null, fetchError: null };
}

export async function fetchRentLedgerForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: RentLedgerListRow[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const { data: ledger, error: ledgerError } = await admin
    .from("rent_ledger")
    .select(
      "tenant_id, entry_id, lease_id, charge_type, description, period_start, period_end, amount_due_ghs, amount_paid_ghs, credit_ghs, payment_method, payment_date, status, verification_status, notes",
    )
    .eq("tenant_id", landlord.tenantId)
    .order("period_start", { ascending: false });

  if (ledgerError) {
    return { rows: [], fetchError: ledgerError.message };
  }

  const ledgerRows = (ledger as LedgerRow[] | null) ?? [];
  if (ledgerRows.length === 0) {
    return { rows: [], fetchError: null };
  }

  const leaseIds = [...new Set(ledgerRows.map((row) => row.lease_id))];

  const [
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", landlord.tenantId)
      .in("lease_id", leaseIds),
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

  const leaseById = new Map(
    (
      (leases as Array<{
        lease_id: string;
        unit_id: string;
        lessee_id: string;
      }> | null) ?? []
    ).map((row) => [row.lease_id, row]),
  );
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

  const rows: RentLedgerListRow[] = [];
  for (const row of ledgerRows) {
    if (!isRentLedgerStatus(row.status)) {
      continue;
    }
    if (!isRentVerificationStatus(row.verification_status)) {
      continue;
    }

    const lease = leaseById.get(row.lease_id);
    const unit = lease ? unitById.get(lease.unit_id) : undefined;
    const propertyName = unit
      ? (propertyNameById.get(unit.property_id) ?? "—")
      : "—";
    const unitNumber = unit?.unit_number ?? "—";
    const tenantName = lease
      ? (lesseeNameById.get(lease.lessee_id) ?? "—")
      : "—";

    rows.push({
      entryId: row.entry_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      tenantName,
      unitLabel: `${propertyName} — ${unitNumber}`,
      chargeType: row.charge_type === "one_time" ? "one_time" : "rent",
      description: row.description?.trim() || null,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      amountDueGhs: toNumber(row.amount_due_ghs),
      amountPaidGhs: toNumber(row.amount_paid_ghs),
      creditGhs: toNumber(row.credit_ghs),
      status: row.status as RentLedgerStatus,
      paymentMethod: row.payment_method,
      paymentDate: row.payment_date,
      verificationStatus: row.verification_status as RentVerificationStatus,
      notes: row.notes,
    });
  }

  return { rows, fetchError: null };
}
