import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LandlordPortalSession } from "@/utils/landlord-portal-auth";
import { formatMaintenanceDate } from "@/app/dashboard/real-estate/maintenance-utils";

export type LandlordPendingCollectionRow = {
  collectionId: string;
  rentLedgerEntryId: string;
  facilityManagerName: string;
  lesseeName: string;
  unitLabel: string;
  amountGhs: number;
  paymentMethod: string;
  paymentMethodLabel: string;
  collectedAtLabel: string;
  notes: string | null;
  ledgerDescription: string | null;
  chargeType: string;
};

const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "Mobile Money",
  bank_transfer: "Bank Transfer",
};

export async function fetchLandlordPendingCollections(
  admin: SupabaseClient,
  session: Pick<LandlordPortalSession, "tenantId">,
): Promise<{ rows: LandlordPendingCollectionRow[]; error: string | null }> {
  const { data: collections, error } = await admin
    .from("facility_manager_collections")
    .select(
      "collection_id, rent_ledger_entry_id, facility_manager_id, lease_id, amount_ghs, payment_method, collected_at, notes",
    )
    .eq("tenant_id", session.tenantId)
    .eq("status", "pending_landlord_confirmation")
    .order("collected_at", { ascending: false });

  if (error) {
    return { rows: [], error: error.message };
  }
  if (!collections?.length) {
    return { rows: [], error: null };
  }

  const fmIds = [
    ...new Set(collections.map((r) => r.facility_manager_id as string)),
  ];
  const entryIds = collections.map((r) => r.rent_ledger_entry_id as string);
  const leaseIds = collections.map((r) => r.lease_id as string);

  const [
    { data: fms },
    { data: ledgerRows },
    { data: leases },
    { data: units },
    { data: properties },
    { data: lessees },
  ] = await Promise.all([
    admin
      .from("facility_managers")
      .select("facility_manager_id, full_name")
      .eq("tenant_id", session.tenantId)
      .in("facility_manager_id", fmIds),
    admin
      .from("rent_ledger")
      .select("entry_id, description, charge_type")
      .eq("tenant_id", session.tenantId)
      .in("entry_id", entryIds),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds),
    admin.from("property_units").select("unit_id, unit_number, property_id").eq("tenant_id", session.tenantId),
    admin.from("properties").select("property_id, name").eq("tenant_id", session.tenantId),
    admin.from("lessees").select("lessee_id, full_name").eq("tenant_id", session.tenantId),
  ]);

  const fmById = new Map(
    (fms ?? []).map((f) => [
      f.facility_manager_id as string,
      String(f.full_name ?? "Facility Manager"),
    ]),
  );
  const ledgerById = new Map(
    (ledgerRows ?? []).map((r) => [
      r.entry_id as string,
      {
        description: r.description ? String(r.description) : null,
        chargeType: String(r.charge_type ?? "rent"),
      },
    ]),
  );
  const propertyById = new Map(
    (properties ?? []).map((p) => [
      p.property_id as string,
      String(p.name ?? "Property"),
    ]),
  );
  const unitById = new Map(
    (units ?? []).map((u) => [
      u.unit_id as string,
      {
        unitNumber: String(u.unit_number ?? ""),
        propertyId: u.property_id as string,
      },
    ]),
  );
  const leaseById = new Map(
    (leases ?? []).map((l) => [
      l.lease_id as string,
      { unitId: l.unit_id as string, lesseeId: l.lessee_id as string },
    ]),
  );
  const lesseeById = new Map(
    (lessees ?? []).map((l) => [
      l.lessee_id as string,
      String(l.full_name ?? "Lessee"),
    ]),
  );

  const rows: LandlordPendingCollectionRow[] = collections.map((row) => {
    const lease = leaseById.get(row.lease_id as string);
    const unit = lease ? unitById.get(lease.unitId) : undefined;
    const propertyName = unit
      ? (propertyById.get(unit.propertyId) ?? "Property")
      : "Property";
    const unitLabel = unit?.unitNumber
      ? `${propertyName} / Unit ${unit.unitNumber}`
      : propertyName;
    const ledger = ledgerById.get(row.rent_ledger_entry_id as string);
    const method = String(row.payment_method ?? "");

    return {
      collectionId: row.collection_id as string,
      rentLedgerEntryId: row.rent_ledger_entry_id as string,
      facilityManagerName:
        fmById.get(row.facility_manager_id as string) ?? "Facility Manager",
      lesseeName: lease
        ? (lesseeById.get(lease.lesseeId) ?? "Lessee")
        : "Lessee",
      unitLabel,
      amountGhs: Number(row.amount_ghs) || 0,
      paymentMethod: method,
      paymentMethodLabel: METHOD_LABELS[method] ?? method,
      collectedAtLabel: formatMaintenanceDate(String(row.collected_at ?? "")),
      notes: row.notes ? String(row.notes) : null,
      ledgerDescription: ledger?.description ?? null,
      chargeType: ledger?.chargeType ?? "rent",
    };
  });

  return { rows, error: null };
}
