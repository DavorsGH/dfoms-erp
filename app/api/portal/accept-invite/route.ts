import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { hashLesseeInviteToken } from "@/utils/lessee-portal-invite";
import {
  mapSupabasePasswordError,
  validatePasswordLength,
} from "@/utils/password-policy";
import { recordPasswordUpdatedAt } from "@/lib/security/password-updated-at";
import { syncAuthUserPortalMetadata } from "@/lib/auth/portal-metadata";
import {
  crossPersonaErrorMessage,
  findCrossPersonaConflictForAuthUid,
  findCrossPersonaConflictForEmail,
} from "@/lib/auth/cross-persona-guard";
import {
  findAuthUserIdByEmail,
  REUSED_ACCOUNT_LOGIN_HINT,
} from "@/utils/email-reuse";

type AcceptInviteBody = {
  token?: string;
  password?: string;
};

async function loadValidInvite(admin: ReturnType<typeof createAdminClient>, rawToken: string) {
  const tokenHash = hashLesseeInviteToken(rawToken);
  const { data: invite, error: inviteError } = await admin
    .from("lessee_portal_invites")
    .select("invite_id, tenant_id, lessee_id, email, expires_at, used_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (inviteError) {
    return { ok: false as const, error: inviteError.message, status: 400 };
  }
  if (!invite) {
    return {
      ok: false as const,
      error: "This invite link is invalid.",
      status: 400,
    };
  }
  if (invite.used_at) {
    return {
      ok: false as const,
      error: "This invite link has already been used.",
      status: 400,
    };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return {
      ok: false as const,
      error:
        "This invite link has expired. Ask your property manager for a new invite.",
      status: 400,
    };
  }

  return { ok: true as const, invite };
}

/**
 * GET: peek whether invite email already has Auth credentials (reuse UX).
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json({ error: "Invite token is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const loaded = await loadValidInvite(admin, token);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const email = String(loaded.invite.email).trim().toLowerCase();
  const authUserId = await findAuthUserIdByEmail(admin, email);
  return NextResponse.json({
    existingAccount: Boolean(authUserId),
    message: authUserId ? REUSED_ACCOUNT_LOGIN_HINT : null,
  });
}

/**
 * Public endpoint: validate invite token, create or link Auth user, set lessees.auth_user_id.
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

  const admin = createAdminClient();
  const loaded = await loadValidInvite(admin, rawToken);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const invite = loaded.invite;
  const nowIso = new Date().toISOString();

  const { data: lessee, error: lesseeError } = await admin
    .from("lessees")
    .select("lessee_id, auth_user_id, email, full_name, status")
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

  const crossByEmail = await findCrossPersonaConflictForEmail(admin, email, {
    targetPersona: "lessee",
  });
  if (crossByEmail) {
    return NextResponse.json(
      { error: crossPersonaErrorMessage(crossByEmail) },
      { status: 409 },
    );
  }

  const existingAuthUserId = await findAuthUserIdByEmail(admin, email);

  if (existingAuthUserId) {
    const crossByAuth = await findCrossPersonaConflictForAuthUid(
      admin,
      existingAuthUserId,
      { targetPersona: "lessee" },
    );
    if (crossByAuth) {
      return NextResponse.json(
        { error: crossPersonaErrorMessage(crossByAuth) },
        { status: 409 },
      );
    }

    const { error: linkError } = await admin
      .from("lessees")
      .update({
        auth_user_id: existingAuthUserId,
        status: "active",
        updated_at: nowIso,
      })
      .eq("tenant_id", invite.tenant_id)
      .eq("lessee_id", invite.lessee_id)
      .is("auth_user_id", null);

    if (linkError) {
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
          error: `Account linked, but invite could not be marked used: ${markUsedError.message}`,
        },
        { status: 400 },
      );
    }

    await syncAuthUserPortalMetadata(existingAuthUserId, "lessee");

    return NextResponse.json({
      success: true,
      reusedExistingAccount: true,
      message: REUSED_ACCOUNT_LOGIN_HINT,
    });
  }

  const lengthError = validatePasswordLength(password);
  if (lengthError) {
    return NextResponse.json({ error: lengthError }, { status: 400 });
  }

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
    return NextResponse.json(
      { error: mapSupabasePasswordError(createError ?? { message }) },
      { status: 400 },
    );
  }

  const authUserId = created.user.id;
  await recordPasswordUpdatedAt(authUserId);

  const { error: linkError } = await admin
    .from("lessees")
    .update({
      auth_user_id: authUserId,
      status: "active",
      updated_at: nowIso,
    })
    .eq("tenant_id", invite.tenant_id)
    .eq("lessee_id", invite.lessee_id)
    .is("auth_user_id", null);

  if (linkError) {
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

  await syncAuthUserPortalMetadata(authUserId, "lessee");

  return NextResponse.json({
    success: true,
    reusedExistingAccount: false,
  });
}
