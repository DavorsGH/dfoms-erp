import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { hashLesseeInviteToken } from "@/utils/lessee-portal-invite";

type AcceptInviteBody = {
  token?: string;
  password?: string;
};

/**
 * Public endpoint: validate invite token, create Auth user, link lessees.auth_user_id.
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
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const tokenHash = hashLesseeInviteToken(rawToken);
  const nowIso = new Date().toISOString();

  const { data: invite, error: inviteError } = await admin
    .from("lessee_portal_invites")
    .select(
      "invite_id, tenant_id, lessee_id, email, expires_at, used_at",
    )
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
      { error: "This invite link has expired. Ask your property manager for a new invite." },
      { status: 400 },
    );
  }

  const { data: lessee, error: lesseeError } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, email, full_name")
    .eq("tenant_id", invite.tenant_id)
    .eq("lessee_id", invite.lessee_id)
    .maybeSingle();

  if (lesseeError) {
    return NextResponse.json({ error: lesseeError.message }, { status: 400 });
  }
  if (!lessee) {
    return NextResponse.json(
      { error: "Tenant record not found for this invite." },
      { status: 404 },
    );
  }
  if (lessee.auth_user_id) {
    return NextResponse.json(
      { error: "This tenant already has a portal account. Please log in." },
      { status: 400 },
    );
  }

  const email = String(invite.email).trim().toLowerCase();

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: lessee.full_name,
        portal: "lessee",
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
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const authUserId = created.user.id;

  const { error: linkError } = await admin
    .from("lessees")
    .update({
      auth_user_id: authUserId,
      updated_at: nowIso,
    })
    .eq("tenant_id", invite.tenant_id)
    .eq("lessee_id", invite.lessee_id)
    .is("auth_user_id", null);

  if (linkError) {
    // Roll back auth user so the invite can be retried cleanly.
    await admin.auth.admin.deleteUser(authUserId);
    return NextResponse.json({ error: linkError.message }, { status: 400 });
  }

  const { error: markUsedError } = await admin
    .from("lessee_portal_invites")
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
