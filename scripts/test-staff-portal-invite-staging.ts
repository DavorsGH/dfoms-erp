/**
 * Staff portal invite flow tests (staging).
 *
 *   npx tsx scripts/test-staff-portal-invite-staging.ts --env-file .env.staging.local
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "StaffInvite-Test-8Qx!";
const stamp = Date.now().toString(36);

function hashStaffInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function generateStaffInviteRawToken(): string {
  return randomBytes(32).toString("hex");
}

async function findCrossPersonaConflictForEmail(
  admin: SupabaseClient,
  email: string,
) {
  const normalized = email.trim().toLowerCase();

  const { data: staffRow } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .ilike("email", normalized)
    .maybeSingle();
  if (staffRow) {
    return { persona: "staff" as const };
  }

  const { data: lesseeRow } = await admin
    .from("lessees")
    .select("lessee_id")
    .ilike("email", normalized)
    .not("auth_user_id", "is", null)
    .maybeSingle();
  if (lesseeRow) {
    return { persona: "lessee" as const };
  }

  const { data: landlordTenant } = await admin
    .from("tenants")
    .select("id")
    .ilike("email", normalized)
    .eq("product_line", "real_estate_only")
    .maybeSingle();

  if (landlordTenant) {
    const { data: landlordMatch } = await admin
      .from("landlords")
      .select("auth_user_id")
      .eq("tenant_id", landlordTenant.id)
      .not("auth_user_id", "is", null)
      .maybeSingle();
    if (landlordMatch?.auth_user_id) {
      return { persona: "landlord" as const };
    }
  }

  return null;
}

async function acceptStaffInvite(
  admin: SupabaseClient,
  rawToken: string,
  password: string,
) {
  const tokenHash = hashStaffInviteToken(rawToken);
  const { data: invite } = await admin
    .from("staff_portal_invites")
    .select(
      "invite_id, tenant_id, email, role, employee_id, client_id, expires_at, used_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!invite) {
    return { ok: false as const, error: "invalid", status: 400 };
  }
  if (invite.used_at) {
    return { ok: false as const, error: "used", status: 400 };
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    return { ok: false as const, error: "expired", status: 400 };
  }

  const email = String(invite.email).trim().toLowerCase();
  const crossPersona = await findCrossPersonaConflictForEmail(admin, email);
  if (crossPersona) {
    return { ok: false as const, error: "cross-persona", status: 409 };
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { portal: "staff" },
    });

  if (createError || !created.user) {
    return {
      ok: false as const,
      error: createError?.message ?? "auth failed",
      status: 400,
    };
  }

  const authUserId = created.user.id;
  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authUserId,
    tenant_id: invite.tenant_id,
    role: invite.role,
    employee_id: invite.employee_id,
    client_id: invite.client_id,
    email,
    is_active: true,
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(authUserId);
    return { ok: false as const, error: insertError.message, status: 400 };
  }

  await admin
    .from("staff_portal_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("invite_id", invite.invite_id)
    .is("used_at", null);

  return { ok: true as const, authUserId };
}

type Cleanup = {
  tenantIds: string[];
  authUids: string[];
  employeeIds: Array<{ tenant_id: string; employee_id: string }>;
  lesseeIds: string[];
  inviteIds: string[];
};

const cleanup: Cleanup = {
  tenantIds: [],
  authUids: [],
  employeeIds: [],
  lesseeIds: [],
  inviteIds: [],
};

function record(name: string, pass: boolean, detail: string) {
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}: ${detail}`);
  if (!pass) {
    throw new Error(`${name}: ${detail}`);
  }
}

async function createTestTenant(admin: SupabaseClient) {
  const slug = `staff-invite-${stamp}`.slice(0, 63);
  const { data, error } = await admin
    .from("tenants")
    .insert({
      name: `Staff Invite Test ${stamp}`,
      slug,
      status: "active",
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "tenant insert failed");
  cleanup.tenantIds.push(data.id);
  return data.id as string;
}

async function createTestEmployee(admin: SupabaseClient, tenantId: string) {
  const employeeId = `SI-${stamp}`.slice(0, 20);
  const staffId = `ST-${stamp}`.slice(0, 20);
  const { error } = await admin.from("employees").insert({
    tenant_id: tenantId,
    employee_id: employeeId,
    staff_id: staffId,
    full_name: `Staff Invite Employee ${stamp}`,
    employment_type: "Permanent",
    employment_status: "Active",
  });
  assert(!error, error?.message ?? "employee insert failed");
  cleanup.employeeIds.push({ tenant_id: tenantId, employee_id: employeeId });
  return employeeId;
}

async function insertInvite(
  admin: SupabaseClient,
  args: {
    tenantId: string;
    email: string;
    role?: string;
    employeeId?: string | null;
    expiresAt?: string;
    usedAt?: string | null;
  },
) {
  const rawToken = generateStaffInviteRawToken();
  const tokenHash = hashStaffInviteToken(rawToken);
  const expiresAt =
    args.expiresAt ??
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await admin
    .from("staff_portal_invites")
    .insert({
      tenant_id: args.tenantId,
      email: args.email.toLowerCase(),
      token_hash: tokenHash,
      role: args.role ?? "employee",
      employee_id: args.employeeId ?? null,
      client_id: null,
      invited_by: null,
      expires_at: expiresAt,
      used_at: args.usedAt ?? null,
      created_at: new Date().toISOString(),
    })
    .select("invite_id")
    .single();

  assert(!error && data, error?.message ?? "invite insert failed");
  cleanup.inviteIds.push(data.invite_id);
  return { rawToken, inviteId: data.invite_id as string };
}

async function invalidateUnusedInvites(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
) {
  await admin
    .from("staff_portal_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("tenant_id", tenantId)
    .ilike("email", email.toLowerCase())
    .is("used_at", null);
}

async function runCleanup(admin: SupabaseClient) {
  for (const authUid of cleanup.authUids) {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    try {
      await admin.auth.admin.deleteUser(authUid);
    } catch {
      // ignore
    }
  }

  for (const lesseeId of cleanup.lesseeIds) {
    await admin.from("lessees").delete().eq("lessee_id", lesseeId);
  }

  for (const inviteId of cleanup.inviteIds) {
    await admin
      .from("staff_portal_invite_supervisor_sites")
      .delete()
      .eq("invite_id", inviteId);
    await admin.from("staff_portal_invites").delete().eq("invite_id", inviteId);
  }

  for (const row of cleanup.employeeIds) {
    await admin
      .from("employees")
      .delete()
      .eq("tenant_id", row.tenant_id)
      .eq("employee_id", row.employee_id);
  }

  for (const tenantId of cleanup.tenantIds) {
    await admin.from("tenants").delete().eq("id", tenantId);
  }
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), "Refusing: not staging Supabase URL");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const tenantId = await createTestTenant(admin);
  const employeeId = await createTestEmployee(admin, tenantId);

  try {
    const acceptEmail = `staff-invite-accept-${stamp}@example.com`;
    const { rawToken: acceptToken } = await insertInvite(admin, {
      tenantId,
      email: acceptEmail,
      employeeId,
    });

    const acceptResult = await acceptStaffInvite(admin, acceptToken, PASSWORD);
    record(
      "valid token accept",
      acceptResult.ok === true,
      acceptResult.ok ? "ok" : acceptResult.error,
    );

    const { data: accountRow } = await admin
      .from("user_accounts")
      .select("auth_uid, tenant_id, role, employee_id, email")
      .ilike("email", acceptEmail)
      .maybeSingle();
    record(
      "user_accounts created",
      Boolean(
        accountRow?.auth_uid &&
          accountRow.tenant_id === tenantId &&
          accountRow.role === "employee" &&
          accountRow.employee_id === employeeId,
      ),
      JSON.stringify(accountRow),
    );
    if (accountRow?.auth_uid) {
      cleanup.authUids.push(accountRow.auth_uid);
    }

    const expiredEmail = `staff-invite-expired-${stamp}@example.com`;
    const { rawToken: expiredToken } = await insertInvite(admin, {
      tenantId,
      email: expiredEmail,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const expiredResult = await acceptStaffInvite(admin, expiredToken, PASSWORD);
    record(
      "expired token rejected",
      !expiredResult.ok && expiredResult.error === "expired",
      expiredResult.ok ? "unexpected ok" : expiredResult.error,
    );

    const usedResult = await acceptStaffInvite(admin, acceptToken, PASSWORD);
    record(
      "used token rejected",
      !usedResult.ok && usedResult.error === "used",
      usedResult.ok ? "unexpected ok" : usedResult.error,
    );

    const lesseeEmail = `staff-invite-lessee-${stamp}@example.com`;
    const { data: lesseeAuth, error: lesseeAuthError } =
      await admin.auth.admin.createUser({
        email: lesseeEmail,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { portal: "lessee" },
      });
    assert(!lesseeAuthError && lesseeAuth.user, lesseeAuthError?.message ?? "lessee auth failed");
    cleanup.authUids.push(lesseeAuth.user.id);

    const { data: lesseeRow, error: lesseeInsertError } = await admin
      .from("lessees")
      .insert({
        tenant_id: tenantId,
        lessee_id: crypto.randomUUID(),
        full_name: "Cross Persona Lessee",
        email: lesseeEmail,
        phone: "+233200000001",
        auth_user_id: lesseeAuth.user.id,
      })
      .select("lessee_id")
      .single();
    assert(!lesseeInsertError && lesseeRow, lesseeInsertError?.message ?? "lessee insert failed");
    cleanup.lesseeIds.push(lesseeRow.lessee_id);

    const crossPersona = await findCrossPersonaConflictForEmail(admin, lesseeEmail);
    record(
      "cross-persona lessee detected",
      crossPersona?.persona === "lessee",
      crossPersona?.persona ?? "none",
    );

    const { rawToken: crossToken } = await insertInvite(admin, {
      tenantId,
      email: lesseeEmail,
    });
    const crossAccept = await acceptStaffInvite(admin, crossToken, PASSWORD);
    record(
      "cross-persona accept rejected",
      !crossAccept.ok && crossAccept.status === 409,
      crossAccept.ok ? "unexpected ok" : crossAccept.error,
    );

    const directEmail = `staff-invite-direct-${stamp}@example.com`;
    const { data: directAuth, error: directAuthError } =
      await admin.auth.admin.createUser({
        email: directEmail,
        password: PASSWORD,
        email_confirm: true,
      });
    assert(!directAuthError && directAuth.user, directAuthError?.message ?? "direct auth failed");
    cleanup.authUids.push(directAuth.user.id);

    const { error: directInsertError } = await admin.from("user_accounts").insert({
      auth_uid: directAuth.user.id,
      tenant_id: tenantId,
      role: "employee",
      employee_id: null,
      client_id: null,
      email: directEmail,
      is_active: true,
    });
    record(
      "direct-create user_accounts",
      !directInsertError,
      directInsertError?.message ?? "inserted",
    );

    const resendEmail = `staff-invite-resend-${stamp}@example.com`;
    const invite1 = await insertInvite(admin, {
      tenantId,
      email: resendEmail,
      employeeId,
    });

    await invalidateUnusedInvites(admin, tenantId, resendEmail);
    const invite2 = await insertInvite(admin, {
      tenantId,
      email: resendEmail,
      employeeId,
    });
    cleanup.inviteIds.push(invite2.inviteId);

    const { data: firstAfterResend } = await admin
      .from("staff_portal_invites")
      .select("used_at")
      .eq("invite_id", invite1.inviteId)
      .maybeSingle();
    record(
      "old token invalidated on resend",
      Boolean(firstAfterResend?.used_at),
      JSON.stringify(firstAfterResend),
    );

    const oldTokenResult = await acceptStaffInvite(admin, invite1.rawToken, PASSWORD);
    record(
      "old token after resend rejected",
      !oldTokenResult.ok && oldTokenResult.error === "used",
      oldTokenResult.ok ? "unexpected ok" : oldTokenResult.error,
    );

    console.log("\nAll staff portal invite staging checks passed.");
  } finally {
    await runCleanup(admin);
    console.log("Cleanup complete.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
