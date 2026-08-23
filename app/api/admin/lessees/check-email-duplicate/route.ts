import { NextResponse } from "next/server";
import { requireDavorsPlatformRealEstateStaff } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { hasDuplicateLesseeEmailOnAnotherRecord } from "@/utils/lessee-email-duplicate-check";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";

type Body = {
  email?: string;
  lessee_id?: string;
  tenant_id?: string;
};

/**
 * Staff Real Estate: soft duplicate-email probe for lessee save / portal invite.
 * Response exposes only { duplicate: boolean } — no other tenant details.
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformRealEstateStaff();
  if (!auth.ok) {
    return auth.response;
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email?.trim() ?? "";
  if (!email) {
    return NextResponse.json({ duplicate: false });
  }

  if (body.tenant_id?.trim()) {
    const admin = createAdminClient();
    const landlord = await assertRealEstateLandlordTenant(admin, body.tenant_id);
    if (!landlord.ok) {
      return NextResponse.json(
        { error: landlord.error },
        { status: landlord.status },
      );
    }
  }

  const admin = createAdminClient();
  try {
    const duplicate = await hasDuplicateLesseeEmailOnAnotherRecord(
      admin,
      email,
      body.lessee_id,
    );
    return NextResponse.json({ duplicate });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to check email.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
