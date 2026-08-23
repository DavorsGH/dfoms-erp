import { NextResponse } from "next/server";
import { requirePlatformOnlyLandlordSession } from "@/utils/landlord-portal-auth";
import { hasDuplicateLesseeEmailOnAnotherRecord } from "@/utils/lessee-email-duplicate-check";

type Body = {
  email?: string;
  lessee_id?: string;
};

/**
 * platform_only landlord: soft duplicate-email probe for tenant save / portal invite.
 * Response exposes only { duplicate: boolean } — no other tenant details.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformOnlyLandlordSession();
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

  if (body.lessee_id?.trim()) {
    const { data: lessee, error: lookupError } = await auth.admin
      .from("lessees")
      .select("lessee_id")
      .eq("tenant_id", auth.session.tenantId)
      .eq("lessee_id", body.lessee_id.trim())
      .maybeSingle();

    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 400 });
    }
    if (!lessee) {
      return NextResponse.json({ error: "Tenant not found." }, { status: 404 });
    }
  }

  try {
    const duplicate = await hasDuplicateLesseeEmailOnAnotherRecord(
      auth.admin,
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
