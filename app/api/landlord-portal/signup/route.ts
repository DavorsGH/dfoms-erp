import { NextResponse } from "next/server";
import {
  createPendingLandlordTenant,
  rollbackPendingLandlordTenant,
  validatePendingLandlordInput,
} from "@/utils/landlord-create";
import { sendLandlordSignupConfirmationEmail } from "@/utils/landlord-signup-emails";
import { resolvePublicSiteUrl } from "@/utils/public-site-url";
import { createAdminClient } from "@/utils/supabase/admin";
import { isDuplicateEmailError } from "@/utils/tenant-signup";
import {
  mapSupabasePasswordError,
  validatePasswordClient,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import {
  assertSignupAllowed,
  getRequestIp,
  recordSignupAttempt,
} from "@/utils/signup-rate-limit";

type SignupBody = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  password?: string;
  confirm_password?: string;
};

/**
 * Public self-signup: create pending landlord tenant + unconfirmed Auth user.
 * Email confirmation triggers auto-approval (see confirm-email route).
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

  const passwordError = validatePasswordClient(password, confirmPassword);
  if (passwordError) {
    return NextResponse.json({ error: passwordError }, { status: 400 });
  }

  const { name, email, phone, address } = validation.data;
  const ip = getRequestIp(request.headers);

  const allowed = await assertSignupAllowed(email, ip);
  if (!allowed.ok) {
    return NextResponse.json({ error: allowed.error }, { status: 429 });
  }

  await recordSignupAttempt(email, ip);

  const admin = createAdminClient();

  const crossPersona = await findCrossPersonaConflictForEmail(admin, email, {
    targetPersona: "landlord",
  });
  if (crossPersona) {
    return NextResponse.json(
      { error: crossPersonaErrorMessage(crossPersona) },
      { status: 409 },
    );
  }

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
      email_confirm: false,
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
    return NextResponse.json(
      { error: mapSupabasePasswordError(createError ?? { message }) },
      { status: 400 },
    );
  }

  const authUserId = authCreated.user.id;
  await recordPasswordUpdatedAt(authUserId);

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

  const { data: linkData, error: verifyLinkError } =
    await admin.auth.admin.generateLink({
      type: "signup",
      email,
      password,
    });

  if (verifyLinkError || !linkData?.properties?.hashed_token) {
    console.error(
      "[landlord-portal/signup] failed to generate verification link:",
      verifyLinkError?.message,
    );
  } else {
    const siteUrl = resolvePublicSiteUrl().replace(/\/$/, "");
    const verifyUrl = `${siteUrl}/landlord-portal/verify-email?token_hash=${linkData.properties.hashed_token}&type=signup`;

    await sendLandlordSignupConfirmationEmail({
      email,
      name,
      verifyUrl,
    });
  }

  return NextResponse.json({
    message:
      "Account created. Check your email for a link to confirm your address before signing in.",
    email,
    tenant_id: tenantId,
  });
}
