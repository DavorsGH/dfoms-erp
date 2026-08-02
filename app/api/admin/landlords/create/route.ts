import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { notifyStaffLandlordPendingApproval } from "@/utils/real-estate-staff-notifications";
import {
  buildUniqueSlugCandidates,
  isDuplicateSlugError,
  normalizeSignupEmail,
  slugifyCompanyName,
} from "@/utils/tenant-signup";

type CreateLandlordBody = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function resolveAvailableSlug(
  admin: ReturnType<typeof createAdminClient>,
  name: string,
): Promise<string | null> {
  const baseSlug = slugifyCompanyName(name);
  const candidates = buildUniqueSlugCandidates(baseSlug);

  const { data: existingRows, error } = await admin
    .from("tenants")
    .select("slug")
    .in("slug", candidates);

  if (error) {
    return null;
  }

  const taken = new Set((existingRows ?? []).map((row) => row.slug));
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: CreateLandlordBody;
  try {
    body = (await request.json()) as CreateLandlordBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  const email = normalizeSignupEmail(body.email ?? "");
  const phone = body.phone?.trim() ?? "";
  const address = body.address?.trim() ?? "";

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!email || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { error: "A valid email is required." },
      { status: 400 },
    );
  }
  if (!phone) {
    return NextResponse.json({ error: "phone is required" }, { status: 400 });
  }
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Soft uniqueness: tenants.email has no DB unique constraint, but portal
  // invites and staff notifications rely on it as the landlord contact.
  const { data: emailMatches, error: emailLookupError } = await admin
    .from("tenants")
    .select("id")
    .eq("product_line", "real_estate_only")
    .ilike("email", email)
    .limit(1);

  if (emailLookupError) {
    return NextResponse.json(
      { error: emailLookupError.message },
      { status: 400 },
    );
  }
  if (emailMatches && emailMatches.length > 0) {
    return NextResponse.json(
      {
        error:
          "A landlord with this email already exists. Use a different email or open the existing landlord.",
      },
      { status: 409 },
    );
  }

  const slug = await resolveAvailableSlug(admin, name);
  if (!slug) {
    return NextResponse.json(
      { error: "Unable to verify landlord name availability. Please try again." },
      { status: 503 },
    );
  }

  const now = new Date().toISOString();

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name,
      slug,
      status: "active",
      product_line: "real_estate_only",
      email,
      phone,
      address,
      updated_at: now,
    })
    .select("id")
    .single();

  if (tenantError || !tenantRow) {
    return NextResponse.json(
      {
        error: isDuplicateSlugError(tenantError?.message ?? "")
          ? "A landlord with a similar name already exists. Try a different name."
          : (tenantError?.message ?? "Failed to create landlord tenant."),
      },
      { status: 400 },
    );
  }

  const tenantId = tenantRow.id as string;

  // Matches update-route pending insert + DB defaults (platform_only, sms 0).
  const { error: landlordError } = await admin.from("landlords").insert({
    tenant_id: tenantId,
    landlord_type: "platform_only",
    approval_status: "pending",
    sms_credit_balance: 0,
    management_fee_percent: null,
    paystack_subaccount_code: null,
    notification_phone: null,
    created_at: now,
    updated_at: now,
  });

  if (landlordError) {
    await admin.from("tenants").delete().eq("id", tenantId);
    return NextResponse.json(
      { error: landlordError.message ?? "Failed to create landlord profile." },
      { status: 400 },
    );
  }

  await notifyStaffLandlordPendingApproval({
    landlordTenantId: tenantId,
    landlordType: "platform_only",
    landlordName: name,
  });

  return NextResponse.json({ success: true, tenant_id: tenantId });
}
