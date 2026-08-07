import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { hashLandlordInviteToken } from "@/utils/landlord-portal-invite";
import {
  mapSupabasePasswordError,
  validatePasswordLength,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";

type AcceptInviteBody = {
  token?: string;
  password?: string;
};

/**
 * Public endpoint: validate invite token, create Auth user, link landlords.auth_user_id.
 */
export async function POST(request: Request) {
  let body: AcceptInviteBody;
  try {
    body = (await request.json()) as AcceptInviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rawToken = body.token?.trim() ?? "";
  const password = body.password ?? "";

  if (!rawToken) {
    return NextResponse.json({ error: "Invite token is required." }, { status: 400 });
  }
  const lengthError = validatePasswordLength(password);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

  const admin = createAdminClient();
  const tokenHash = hashLandlordInviteToken(rawToken);
  const nowIso = new Date().toISOString();

  const { data: invite, error: inviteError } = await admin
    .from("landlord_portal_invites")
    .select("invite_id, tenant_id, email, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError) {
    return NextResponse.json({ error: inviteError.message }, { status: 400 });
  }
  if (!invite) {
    return NextResponse.json(
      { error: "This invite link is invalid." },
      { status: 400 },
    );
  }
  if (invite.used_at) {
    return NextResponse.json(
      { error: "This invite link has already been used." },
      { status: 400 },
    );
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json(
      {
        error:
          "This invite link has expired. Ask Davors staff for a new invite.",
      },
      { status: 400 },
    );
  }

  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("tenant_id, auth_user_id, approval_status")
    .eq("tenant_id", invite.tenant_id)
    .maybeSingle();

  if (landlordError) {
    return NextResponse.json({ error: landlordError.message }, { status: 400 });
  }
  if (!landlord) {
    return NextResponse.json(
      { error: "Landlord record not found for this invite." },
      { status: 404 },
    );
  }
  if (landlord.approval_status !== "approved") {
    return NextResponse.json(
      { error: "This landlord account is not approved for portal access." },
      { status: 400 },
    );
  }
  if (landlord.auth_user_id) {
    return NextResponse.json(
      { error: "This landlord already has a portal account. Please log in." },
      { status: 400 },
    );
  }

  const { data: tenant } = await admin
    .from("tenants")
    .select("name")
    .eq("id", invite.tenant_id)
    .maybeSingle();

  const email = String(invite.email).trim().toLowerCase();

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: tenant?.name ?? email,
        portal: "landlord",
      },
    });

  if (createError || !created.user) {
    const message = createError?.message ?? "Unable to create portal account.";
    if (/already|registered|exists/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "An account with this email already exists. Try logging in, or contact support if you need help.",
        },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: mapSupabasePasswordError(createError ?? { message }) },
      { status: 400 },
    );
  }

  const authUserId = created.user.id;
  await recordPasswordUpdatedAt(authUserId);

  const { error: linkError } = await admin
    .from("landlords")
    .update({
      auth_user_id: authUserId,
      updated_at: nowIso,
    })
    .eq("tenant_id", invite.tenant_id)
    .is("auth_user_id", null);

  if (linkError) {
    await admin.auth.admin.deleteUser(authUserId);
    return NextResponse.json({ error: linkError.message }, { status: 400 });
  }

  const { error: markUsedError } = await admin
    .from("landlord_portal_invites")
    .update({ used_at: nowIso })
    .eq("invite_id", invite.invite_id)
    .is("used_at", null);

  if (markUsedError) {
    return NextResponse.json(
      {
        error: `Account created, but invite could not be marked used: ${markUsedError.message}`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ success: true });
}
