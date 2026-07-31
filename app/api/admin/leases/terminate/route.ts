import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";

type TerminateLeaseBody = {
  tenant_id?: string;
  lease_id?: string;
  termination_reason?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: TerminateLeaseBody;
  try {
    body = (await request.json()) as TerminateLeaseBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const terminationReason = body.termination_reason?.trim() ?? "";
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (!terminationReason) {
    return NextResponse.json(
      { error: "termination_reason is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, unit_id, status")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }
  if (lease.status !== "active") {
    return NextResponse.json(
      { error: "Only active leases can be terminated early." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();

  const { error: updateError } = await admin
    .from("leases")
    .update({
      status: "terminated_early",
      terminated_at: now,
      termination_reason: terminationReason,
      updated_at: now,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
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
    return NextResponse.json({ error: unitError.message }, { status: 400 });
  }

  const { data: deposit } = await admin
    .from("security_deposits")
    .select("deposit_id")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    deposit_id: deposit?.deposit_id ?? null,
  });
}
