import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { hashFacilityManagerInviteToken } from "@/utils/facility-manager-portal-invite";
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

async function loadValidInvite(
  admin: ReturnType<typeof createAdminClient>,
  rawToken: string,
) {
  const tokenHash = hashFacilityManagerInviteToken(rawToken);
  const { data: invite, error: inviteError } = await admin
    .from("facility_manager_portal_invites")
    .select(
      "invite_id, tenant_id, facility_manager_id, email, expires_at, used_at",
    )
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
        "This invite link has expired. Ask your landlord for a new invite.",
      status: 400,
    };
  }

  return { ok: true as const, invite };
}

/**
 * GET: peek invite details (email, landlord name, expiry, existing auth).
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token")?.trim() ?? "";
  if (!token) {
    return NextResponse.json(
      { error: "Invite token is required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const loaded = await loadValidInvite(admin, token);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const email = String(loaded.invite.email).trim().toLowerCase();
  const [{ data: tenant }, { data: fm }] = await Promise.all([
    admin
      .from("tenants")
      .select("name")
      .eq("id", loaded.invite.tenant_id)
      .maybeSingle(),
    admin
      .from("facility_managers")
      .select("full_name, status, auth_user_id")
      .eq("tenant_id", loaded.invite.tenant_id)
      .eq("facility_manager_id", loaded.invite.facility_manager_id)
      .maybeSingle(),
  ]);

  if (!fm || fm.status === "revoked") {
    return NextResponse.json(
      { error: "This invite is no longer valid." },
      { status: 400 },
    );
  }
  if (fm.auth_user_id) {
    return NextResponse.json(
      { error: "This facility manager already has a portal account. Please log in." },
      { status: 400 },
    );
  }

  const authUserId = await findAuthUserIdByEmail(admin, email);
  return NextResponse.json({
    email,
    full_name: fm.full_name,
    landlord_name:
      typeof tenant?.name === "string" && tenant.name.trim()
        ? tenant.name.trim()
        : "Your landlord",
    expires_at: loaded.invite.expires_at,
    existingAccount: Boolean(authUserId),
    message: authUserId ? REUSED_ACCOUNT_LOGIN_HINT : null,
  });
}

/**
 * Public endpoint: validate invite token, create or link Auth user, activate FM.
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
    return NextResponse.json(
      { error: "Invite token is required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const loaded = await loadValidInvite(admin, rawToken);
  if (!loaded.ok) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }

  const invite = loaded.invite;
  const nowIso = new Date().toISOString();

  const { data: fm, error: fmError } = await admin
    .from("facility_managers")
    .select("facility_manager_id, auth_user_id, full_name, email, status")
    .eq("tenant_id", invite.tenant_id)
    .eq("facility_manager_id", invite.facility_manager_id)
    .maybeSingle();

  if (fmError) {
    return NextResponse.json({ error: fmError.message }, { status: 400 });
  }
  if (!fm) {
    return NextResponse.json(
      { error: "Facility manager record not found for this invite." },
      { status: 404 },
    );
  }
  if (fm.status === "revoked") {
    return NextResponse.json(
      { error: "This facility manager invite has been revoked." },
      { status: 400 },
    );
  }
  if (fm.auth_user_id) {
    return NextResponse.json(
      {
        error:
          "This facility manager already has a portal account. Please log in.",
      },
      { status: 400 },
    );
  }

  const email = String(invite.email).trim().toLowerCase();

  const crossByEmail = await findCrossPersonaConflictForEmail(admin, email, {
    targetPersona: "facility_manager",
    excludeFacilityManagerId: invite.facility_manager_id,
  });
  if (crossByEmail) {
    return NextResponse.json(
      { error: crossPersonaErrorMessage(crossByEmail) },
      { status: 409 },
    );
  }

  const existingAuthUserId = await findAuthUserIdByEmail(admin, email);

  async function activateAndMarkUsed(authUserId: string) {
    const { error: linkError } = await admin
      .from("facility_managers")
      .update({
        auth_user_id: authUserId,
        status: "active",
        activated_at: nowIso,
        updated_at: nowIso,
      })
      .eq("tenant_id", invite.tenant_id)
      .eq("facility_manager_id", invite.facility_manager_id)
      .is("auth_user_id", null);

    if (linkError) {
      return { ok: false as const, error: linkError.message };
    }

    const { error: markUsedError } = await admin
      .from("facility_manager_portal_invites")
      .update({ used_at: nowIso })
      .eq("invite_id", invite.invite_id)
      .is("used_at", null);

    if (markUsedError) {
      return {
        ok: false as const,
        error: `Account linked, but invite could not be marked used: ${markUsedError.message}`,
      };
    }

    await syncAuthUserPortalMetadata(authUserId, "facility_manager");
    return { ok: true as const };
  }

  if (existingAuthUserId) {
    const crossByAuth = await findCrossPersonaConflictForAuthUid(
      admin,
      existingAuthUserId,
      {
        targetPersona: "facility_manager",
        excludeFacilityManagerId: invite.facility_manager_id,
      },
    );
    if (crossByAuth) {
      return NextResponse.json(
        { error: crossPersonaErrorMessage(crossByAuth) },
        { status: 409 },
      );
    }

    const activated = await activateAndMarkUsed(existingAuthUserId);
    if (!activated.ok) {
      return NextResponse.json({ error: activated.error }, { status: 400 });
    }

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
        full_name: fm.full_name,
        portal: "facility_manager",
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

  const activated = await activateAndMarkUsed(authUserId);
  if (!activated.ok) {
    await admin.auth.admin.deleteUser(authUserId);
    return NextResponse.json({ error: activated.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
