import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";

type RentChangeBody = {
  tenant_id?: string;
  lease_id?: string;
  action?: "approve" | "reject";
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: RentChangeBody;
  try {
    body = (await request.json()) as RentChangeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const action = body.action;
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be approve or reject." },
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
    .select("lease_id, pending_rent_amount_ghs, rent_change_status")
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }
  if (lease.rent_change_status !== "pending_staff_approval") {
    return NextResponse.json(
      { error: "No pending rent change to review." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  if (action === "approve") {
    const pending = Number(lease.pending_rent_amount_ghs);
    if (!Number.isFinite(pending) || pending < 0) {
      return NextResponse.json(
        { error: "pending_rent_amount_ghs is invalid." },
        { status: 400 },
      );
    }

    const { error } = await admin
      .from("leases")
      .update({
        rent_amount_ghs: pending,
        pending_rent_amount_ghs: null,
        rent_change_status: "approved",
        updated_at: now,
      })
      .eq("tenant_id", landlord.tenantId)
      .eq("lease_id", leaseId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  } else {
    const { error } = await admin
      .from("leases")
      .update({
        pending_rent_amount_ghs: null,
        rent_change_status: "rejected",
        updated_at: now,
      })
      .eq("tenant_id", landlord.tenantId)
      .eq("lease_id", leaseId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ success: true });
}
