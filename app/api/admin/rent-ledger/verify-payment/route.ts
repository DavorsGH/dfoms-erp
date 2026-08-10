import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";

type VerifyPaymentBody = {
  tenant_id?: string;
  entry_id?: string;
};

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: VerifyPaymentBody;
  try {
    body = (await request.json()) as VerifyPaymentBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const entryId = body.entry_id?.trim() ?? "";
  if (!entryId) {
    return NextResponse.json({ error: "entry_id is required" }, { status: 400 });
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

  const { data: entry, error: entryError } = await admin
    .from("rent_ledger")
    .select("entry_id, verification_status")
    .eq("tenant_id", landlord.tenantId)
    .eq("entry_id", entryId)
    .maybeSingle();

  if (entryError) {
    return NextResponse.json({ error: entryError.message }, { status: 400 });
  }
  if (!entry) {
    return NextResponse.json(
      { error: "Rent ledger entry not found." },
      { status: 404 },
    );
  }
  if (entry.verification_status !== "pending_verification") {
    return NextResponse.json(
      { error: "This payment is not awaiting verification." },
      { status: 400 },
    );
  }

  const { error: updateError } = await admin
    .from("rent_ledger")
    .update({
      verification_status: "verified",
      verified_by: auth.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("entry_id", entryId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
