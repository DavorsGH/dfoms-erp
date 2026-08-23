/**
 * Staging: staff Tenant detail portal invite / resend / accept state machine.
 * Standalone — avoids server-only imports.
 *
 *   npx tsx scripts/_test-staff-lessee-portal-invite-staging.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { deriveLesseePortalAccessState } from "../utils/lessee-portal-access";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PASSWORD = "PortalInvite-Test-8Qx!";
const stamp = Date.now().toString(36);

function loadEnvForce(filePath: string) {
  const content = readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function findActiveStaffConflict(admin: SupabaseClient, email: string) {
  const { data } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .ilike("email", email.trim().toLowerCase())
    .eq("is_active", true)
    .maybeSingle();
  return Boolean(data);
}

/** Mirrors createAndSendLesseePortalInvite without Resend (token stored for accept). */
async function createInviteRecord(
  admin: SupabaseClient,
  args: { tenantId: string; lesseeId: string; email: string },
) {
  if (await findActiveStaffConflict(admin, args.email)) {
    return { ok: false as const, error: "cross-persona staff conflict" };
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("auth_user_id")
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId)
    .maybeSingle();
  if (lessee?.auth_user_id) {
    return { ok: false as const, error: "already has portal account" };
  }

  const rawToken = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setDate(expiresAt.getDate() + 7);

  await admin
    .from("lessee_portal_invites")
    .update({ used_at: now.toISOString() })
    .eq("tenant_id", args.tenantId)
    .eq("lessee_id", args.lesseeId)
    .is("used_at", null);

  const { error } = await admin.from("lessee_portal_invites").insert({
    tenant_id: args.tenantId,
    lessee_id: args.lesseeId,
    email: args.email,
    token_hash: hashToken(rawToken),
    expires_at: expiresAt.toISOString(),
    used_at: null,
    created_at: now.toISOString(),
  });
  if (error) return { ok: false as const, error: error.message };

  return {
    ok: true as const,
    rawToken,
    expiresAt: expiresAt.toISOString(),
  };
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ${STAGING_REF}`);
  assert(serviceKey, "Missing service role key");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: landlords } = await admin
    .from("landlords")
    .select("tenant_id")
    .limit(1);
  const tenantId = landlords?.[0]?.tenant_id;
  assert(tenantId, "Need a landlord tenant on staging");

  const email = `portal.invite.${stamp}@example.com`;
  const lesseeId = crypto.randomUUID();
  const createdAuthIds: string[] = [];
  const extraLesseeIds: string[] = [];

  try {
    const { error: insertError } = await admin.from("lessees").insert({
      tenant_id: tenantId,
      lessee_id: lesseeId,
      full_name: `Portal Invite Probe ${stamp}`,
      phone: "0201111222",
      email,
      status: "active",
      auth_user_id: null,
    });
    assert(!insertError, insertError?.message ?? "insert lessee");

    let state = deriveLesseePortalAccessState({
      authUserId: null,
      status: "active",
      pendingInviteExpiresAt: null,
    });
    assert(state === "not_invited", "expected not_invited");
    console.log("State not_invited: PASS");

    // Cross-persona: active staff blocks invite
    const conflictEmail = `portal.conflict.${stamp}@example.com`;
    const { data: staffAuth, error: staffAuthError } =
      await admin.auth.admin.createUser({
        email: conflictEmail,
        password: PASSWORD,
        email_confirm: true,
      });
    assert(!staffAuthError && staffAuth.user, staffAuthError?.message ?? "staff auth");
    createdAuthIds.push(staffAuth.user.id);
    await admin.from("user_accounts").insert({
      auth_uid: staffAuth.user.id,
      tenant_id: DAVORS,
      role: "employee",
      email: conflictEmail,
      is_active: true,
    });

    const conflictLesseeId = crypto.randomUUID();
    extraLesseeIds.push(conflictLesseeId);
    await admin.from("lessees").insert({
      tenant_id: tenantId,
      lessee_id: conflictLesseeId,
      full_name: `Conflict Lessee ${stamp}`,
      phone: "0201111333",
      email: conflictEmail,
      status: "active",
      auth_user_id: null,
    });

    const blocked = await createInviteRecord(admin, {
      tenantId,
      lesseeId: conflictLesseeId,
      email: conflictEmail,
    });
    assert(!blocked.ok, "cross-persona should block invite");
    console.log("Cross-persona blocks invite: PASS");

    // Send invite
    const sent = await createInviteRecord(admin, {
      tenantId,
      lesseeId,
      email,
    });
    assert(sent.ok, sent.ok ? "" : sent.error);
    state = deriveLesseePortalAccessState({
      authUserId: null,
      status: "active",
      pendingInviteExpiresAt: sent.expiresAt,
    });
    assert(state === "invited", "expected invited after send");
    console.log("Send invite → state invited: PASS");

    // Resend (invalidates prior unused, inserts new)
    const resent = await createInviteRecord(admin, {
      tenantId,
      lesseeId,
      email,
    });
    assert(resent.ok, resent.ok ? "" : resent.error);
    state = deriveLesseePortalAccessState({
      authUserId: null,
      status: "active",
      pendingInviteExpiresAt: resent.expiresAt,
    });
    assert(state === "invited", "still invited after resend");
    console.log("Resend invite → state invited: PASS");

    // Accept: create Auth + link
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { portal: "lessee" },
      });
    assert(!createError && created.user, createError?.message ?? "create auth");
    createdAuthIds.push(created.user.id);

    await admin
      .from("lessees")
      .update({
        auth_user_id: created.user.id,
        status: "active",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId)
      .eq("lessee_id", lesseeId)
      .is("auth_user_id", null);

    await admin
      .from("lessee_portal_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("lessee_id", lesseeId)
      .is("used_at", null);

    const { data: linked } = await admin
      .from("lessees")
      .select("auth_user_id, status")
      .eq("tenant_id", tenantId)
      .eq("lessee_id", lesseeId)
      .single();

    state = deriveLesseePortalAccessState({
      authUserId: linked?.auth_user_id,
      status: linked?.status,
      pendingInviteExpiresAt: null,
    });
    assert(state === "active", "expected active after accept");
    console.log("Accept → state active (linked): PASS");

    console.log("\nALL STAFF LESSEE PORTAL INVITE PROBES PASSED\n");
  } finally {
    for (const id of [lesseeId, ...extraLesseeIds]) {
      await admin
        .from("lessee_portal_invites")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("lessee_id", id);
      await admin
        .from("lessees")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("lessee_id", id);
    }
    for (const id of createdAuthIds) {
      await admin.from("user_accounts").delete().eq("auth_uid", id);
      await admin.auth.admin.deleteUser(id).catch(() => undefined);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
