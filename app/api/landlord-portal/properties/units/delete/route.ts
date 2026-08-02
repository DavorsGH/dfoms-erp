import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";

type DeleteUnitBody = {
  unit_id?: string;
};

type UnitDeleteBlockers = {
  leaseCount: number;
  activeLeaseCount: number;
  rentLedgerCount: number;
  applicationCount: number;
  isOccupied: boolean;
};

function buildUnitDeleteBlockedMessage(blockers: UnitDeleteBlockers): string {
  const reasons: string[] = [];

  if (blockers.isOccupied || blockers.activeLeaseCount > 0) {
    reasons.push("an active tenant or lease");
  } else if (blockers.leaseCount > 0) {
    const n = blockers.leaseCount;
    reasons.push(`${n} lease${n === 1 ? "" : "s"} on record`);
  }

  if (blockers.rentLedgerCount > 0) {
    const n = blockers.rentLedgerCount;
    reasons.push(`${n} rent ledger entr${n === 1 ? "y" : "ies"}`);
  }

  if (blockers.applicationCount > 0) {
    const n = blockers.applicationCount;
    reasons.push(`${n} rental application${n === 1 ? "" : "s"}`);
  }

  if (reasons.length === 0) {
    return "This unit can't be deleted.";
  }

  return `This unit has ${reasons.join(", ")} and can't be deleted.`;
}

async function loadUnitDeleteBlockers(
  admin: SupabaseClient,
  tenantId: string,
  unitId: string,
): Promise<
  | { ok: true; blockers: UnitDeleteBlockers }
  | { ok: false; error: string; status: number }
> {
  const { data: unit, error: unitError } = await admin
    .from("property_units")
    .select("unit_id, status")
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId)
    .maybeSingle();

  if (unitError) {
    return { ok: false, error: unitError.message, status: 400 };
  }
  if (!unit) {
    return { ok: false, error: "Unit not found.", status: 404 };
  }

  const { data: leases, error: leasesError } = await admin
    .from("leases")
    .select("lease_id, status")
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId);

  if (leasesError) {
    return { ok: false, error: leasesError.message, status: 400 };
  }

  const leaseRows =
    (leases as Array<{ lease_id: string; status: string }> | null) ?? [];
  const leaseIds = leaseRows.map((row) => row.lease_id);
  const activeLeaseCount = leaseRows.filter(
    (row) => row.status === "active",
  ).length;

  let rentLedgerCount = 0;
  if (leaseIds.length > 0) {
    const { count, error: ledgerError } = await admin
      .from("rent_ledger")
      .select("entry_id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .in("lease_id", leaseIds);

    if (ledgerError) {
      return { ok: false, error: ledgerError.message, status: 400 };
    }
    rentLedgerCount = count ?? 0;
  }

  const { count: applicationCount, error: applicationsError } = await admin
    .from("rental_applications")
    .select("application_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId);

  if (applicationsError) {
    return { ok: false, error: applicationsError.message, status: 400 };
  }

  return {
    ok: true,
    blockers: {
      leaseCount: leaseRows.length,
      activeLeaseCount,
      rentLedgerCount,
      applicationCount: applicationCount ?? 0,
      isOccupied: unit.status === "occupied",
    },
  };
}

function hasUnitDeleteBlockers(blockers: UnitDeleteBlockers): boolean {
  return (
    blockers.isOccupied ||
    blockers.leaseCount > 0 ||
    blockers.rentLedgerCount > 0 ||
    blockers.applicationCount > 0
  );
}

/**
 * platform_only: delete a unit in the landlord's own tenant.
 * Safe-delete: blocks when the unit has leases, rent ledger history,
 * rental applications, or is occupied.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
  if (!auth.ok) {
    return auth.response;
  }

  let body: DeleteUnitBody;
  try {
    body = (await request.json()) as DeleteUnitBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const unitId = body.unit_id?.trim() ?? "";
  if (!unitId) {
    return NextResponse.json({ error: "unit_id is required" }, { status: 400 });
  }

  const preview = await loadUnitDeleteBlockers(
    auth.admin,
    auth.session.tenantId,
    unitId,
  );
  if (!preview.ok) {
    return NextResponse.json(
      { error: preview.error },
      { status: preview.status },
    );
  }

  if (hasUnitDeleteBlockers(preview.blockers)) {
    return NextResponse.json(
      {
        can_delete: false,
        error: buildUnitDeleteBlockedMessage(preview.blockers),
        blockers: preview.blockers,
      },
      { status: 409 },
    );
  }

  // Drop unused apply-link tokens for this unit (not historical tenant data).
  const { error: linksError } = await auth.admin
    .from("rental_application_links")
    .delete()
    .eq("tenant_id", auth.session.tenantId)
    .eq("unit_id", unitId);

  if (linksError) {
    return NextResponse.json({ error: linksError.message }, { status: 400 });
  }

  const { data, error } = await auth.admin
    .from("property_units")
    .delete()
    .eq("tenant_id", auth.session.tenantId)
    .eq("unit_id", unitId)
    .select("unit_id")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!data) {
    return NextResponse.json({ error: "Unit not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, can_delete: true });
}
