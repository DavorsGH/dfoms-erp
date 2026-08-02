import { NextResponse } from "next/server";
import {
  createPendingLandlordTenant,
  rollbackPendingLandlordTenant,
  validatePendingLandlordInput,
} from "@/utils/landlord-create";
import { notifyStaffLandlordPendingApproval } from "@/utils/real-estate-staff-notifications";
import { createAdminClient } from "@/utils/supabase/admin";
import { isDuplicateEmailError } from "@/utils/tenant-signup";

type SignupBody = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  password?: string;
  confirm_password?: string;
};

/**
 * Public self-signup: create pending landlord tenant + Auth user, link
 * landlords.auth_user_id, notify staff. Caller should sign the user in.
 */
export async function POST(request: Request) {
  let body: SignupBody;
  try {
    body = (await request.json()) as SignupBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const validation = validatePendingLandlordInput({
    name: body.name,
    email: body.email,
    phone: body.phone,
    address: body.address,
  });
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const password = body.password ?? "";
  const confirmPassword = body.confirm_password ?? "";

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }
  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: "Password and confirmation do not match." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const { name, email, phone, address } = validation.data;

  const created = await createPendingLandlordTenant(admin, {
    name,
    email,
    phone,
    address,
  });

  if (!created.ok) {
    const error =
      created.status === 409
        ? "A landlord account with this email already exists. Try signing in instead."
        : created.error;
    return NextResponse.json({ error }, { status: created.status });
  }

  const tenantId = created.tenantId;
  const nowIso = new Date().toISOString();

  const { data: authCreated, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: name,
        portal: "landlord",
      },
    });

  if (createError || !authCreated.user) {
    await rollbackPendingLandlordTenant(admin, tenantId);
    const message = createError?.message ?? "Unable to create portal account.";
    if (isDuplicateEmailError(message)) {
      return NextResponse.json(
        {
          error:
            "An account with this email already exists. Try logging in, or contact support if you need help.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const authUserId = authCreated.user.id;

  const { error: linkError } = await admin
    .from("landlords")
    .update({
      auth_user_id: authUserId,
      updated_at: nowIso,
    })
    .eq("tenant_id", tenantId)
    .is("auth_user_id", null);

  if (linkError) {
    await admin.auth.admin.deleteUser(authUserId);
    await rollbackPendingLandlordTenant(admin, tenantId);
    return NextResponse.json(
      { error: linkError.message ?? "Failed to link portal account." },
      { status: 400 },
    );
  }

  await notifyStaffLandlordPendingApproval({
    landlordTenantId: tenantId,
    landlordType: "platform_only",
    landlordName: name,
  });

  return NextResponse.json({
    success: true,
    tenant_id: tenantId,
    email,
  });
}
