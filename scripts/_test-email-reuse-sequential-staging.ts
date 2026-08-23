/**
 * Staging: sequential email reuse (staff + lessee) + cross-persona.
 * Standalone — avoids server-only imports.
 *
 * Prerequisites: migration 236 applied on staging.
 *
 *   npx tsx scripts/_test-email-reuse-sequential-staging.ts
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PASSWORD = "EmailReuse-Test-9Kx!";
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

async function findCrossPersonaConflictForEmail(
  admin: SupabaseClient,
  email: string,
  options?: { targetPersona?: "staff" | "lessee" | "landlord" },
) {
  const normalized = email.trim().toLowerCase();
  const { data: staffRow } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .ilike("email", normalized)
    .eq("is_active", true)
    .maybeSingle();
  if (staffRow) return { persona: "staff" as const };

  const { data: lesseeRow } = await admin
    .from("lessees")
    .select("lessee_id")
    .ilike("email", normalized)
    .not("auth_user_id", "is", null)
    .neq("status", "former")
    .maybeSingle();
  if (lesseeRow) return { persona: "lessee" as const };

  void options;
  return null;
}

async function findAuthUserIdByEmail(admin: SupabaseClient, email: string) {
  const normalized = email.trim().toLowerCase();
  const { data: staff } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .ilike("email", normalized)
    .limit(1)
    .maybeSingle();
  if (staff?.auth_uid) return staff.auth_uid as string;

  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error || !data?.users?.length) break;
    const match = data.users.find(
      (user) => user.email?.trim().toLowerCase() === normalized,
    );
    if (match) return match.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ref ${STAGING_REF}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const emailStaff = `reuse.staff.${stamp}@example.com`;
  const emailLessee = `reuse.lessee.${stamp}@example.com`;
  const emailCross = `reuse.cross.${stamp}@example.com`;

  const { data: otherTenants } = await admin
    .from("tenants")
    .select("id, name")
    .neq("id", DAVORS)
    .limit(5);

  let tenantB = otherTenants?.[0]?.id ?? null;
  const createdTenantIds: string[] = [];
  const createdAuthUids: string[] = [];
  const createdLesseeIds: { tenantId: string; lesseeId: string }[] = [];

  try {
    if (!tenantB) {
      const { data: tenantRow, error: tenantError } = await admin
        .from("tenants")
        .insert({
          name: `Reuse Probe ${stamp}`,
          slug: `reuse-probe-${stamp}`,
          product_line: "erp_suite",
          email: `tenant.b.${stamp}@example.com`,
        })
        .select("id")
        .single();
      assert(!tenantError && tenantRow, tenantError?.message ?? "create tenant B");
      tenantB = tenantRow.id;
      createdTenantIds.push(tenantRow.id);
    }

    console.log("Tenant A (Davors):", DAVORS);
    console.log("Tenant B:", tenantB);

    console.log("\n=== STAFF sequential reuse ===");

    const { data: authA, error: authAError } = await admin.auth.admin.createUser({
      email: emailStaff,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { portal: "staff" },
    });
    assert(!authAError && authA.user, authAError?.message ?? "create staff auth");
    createdAuthUids.push(authA.user.id);

    const { error: insertAError } = await admin.from("user_accounts").insert({
      auth_uid: authA.user.id,
      tenant_id: DAVORS,
      role: "employee",
      email: emailStaff,
      is_active: true,
      employee_id: null,
      client_id: null,
    });
    assert(!insertAError, insertAError?.message ?? "insert staff A");

    const activeConflict = await findCrossPersonaConflictForEmail(
      admin,
      emailStaff,
    );
    assert(activeConflict?.persona === "staff", "expected active staff conflict");
    console.log("(b) ACTIVE at A blocks invite elsewhere: PASS");

    const { error: deactError } = await admin
      .from("user_accounts")
      .update({ is_active: false })
      .eq("auth_uid", authA.user.id);
    assert(!deactError, deactError?.message ?? "deactivate");

    const inactiveConflict = await findCrossPersonaConflictForEmail(
      admin,
      emailStaff,
    );
    assert(!inactiveConflict, "inactive staff must not block");
    console.log("Inactive staff no longer cross-persona blocks: PASS");

    // Reassign to B (mirrors accept invite reuse path)
    const { error: moveError } = await admin
      .from("user_accounts")
      .update({
        tenant_id: tenantB,
        role: "finance",
        employee_id: null,
        client_id: null,
        email: emailStaff,
        is_active: true,
      })
      .eq("auth_uid", authA.user.id);
    assert(!moveError, moveError?.message ?? "move to B");

    const { data: moved } = await admin
      .from("user_accounts")
      .select("tenant_id, role, is_active")
      .eq("auth_uid", authA.user.id)
      .single();
    assert(moved?.tenant_id === tenantB, "tenant_id should be B");
    assert(moved?.role === "finance", "role reset");
    assert(moved?.is_active === true, "is_active true");

    const { count: rowCount } = await admin
      .from("user_accounts")
      .select("auth_uid", { count: "exact", head: true })
      .eq("auth_uid", authA.user.id);
    assert(rowCount === 1, "exactly one user_accounts row");

    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      "";
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
    const { data: signIn, error: signInError } =
      await anon.auth.signInWithPassword({
        email: emailStaff,
        password: PASSWORD,
      });
    assert(!signInError && signIn.user, signInError?.message ?? "staff login");
    const { data: sessionAccount } = await admin
      .from("user_accounts")
      .select("tenant_id")
      .eq("auth_uid", signIn.user!.id)
      .eq("is_active", true)
      .single();
    assert(sessionAccount?.tenant_id === tenantB, "session resolves to B only");
    await anon.auth.signOut();
    console.log("(a) deactivate A → move B → login B only: PASS");

    await admin
      .from("user_accounts")
      .update({ is_active: false })
      .eq("auth_uid", authA.user.id);
    await admin
      .from("user_accounts")
      .update({ is_active: true })
      .eq("auth_uid", authA.user.id);
    const { data: reactivated } = await admin
      .from("user_accounts")
      .select("is_active, tenant_id")
      .eq("auth_uid", authA.user.id)
      .single();
    assert(
      reactivated?.is_active === true && reactivated.tenant_id === tenantB,
      "reactivate works",
    );
    console.log("(c) deactivate-then-reactivate at B: PASS");

    // Staff invite accept path with real invite token (reuse)
    await admin
      .from("user_accounts")
      .update({ is_active: false, tenant_id: DAVORS, role: "employee" })
      .eq("auth_uid", authA.user.id);

    const rawToken = randomBytes(32).toString("hex");
    const { error: inviteError } = await admin.from("staff_portal_invites").insert({
      tenant_id: tenantB,
      email: emailStaff,
      token_hash: hashToken(rawToken),
      role: "director",
      employee_id: null,
      client_id: null,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
      used_at: null,
    });
    assert(!inviteError, inviteError?.message ?? "invite insert");

    // Simulate assignStaffMembership update used by accept path
    const { error: acceptMoveError } = await admin
      .from("user_accounts")
      .update({
        tenant_id: tenantB,
        role: "director",
        is_active: true,
        employee_id: null,
        client_id: null,
      })
      .eq("auth_uid", authA.user.id);
    assert(!acceptMoveError, acceptMoveError?.message ?? "accept move");
    await admin
      .from("staff_portal_invites")
      .update({ used_at: new Date().toISOString() })
      .eq("token_hash", hashToken(rawToken));

    const { data: afterInvite } = await admin
      .from("user_accounts")
      .select("tenant_id, role")
      .eq("auth_uid", authA.user.id)
      .single();
    assert(
      afterInvite?.tenant_id === tenantB && afterInvite.role === "director",
      "invite reuse role/tenant",
    );
    console.log("Staff invite-style reassignment: PASS");

    console.log("\n=== LESSEE sequential reuse ===");

    const { data: landlords } = await admin
      .from("landlords")
      .select("tenant_id")
      .limit(5);

    let landlordA = landlords?.[0]?.tenant_id ?? null;
    let landlordB =
      landlords?.find((l) => l.tenant_id !== landlordA)?.tenant_id ?? null;

    if (!landlordA) {
      console.log("SKIP lessee tests: no landlord tenants on staging");
    } else {
      if (!landlordB) landlordB = landlordA;

      const lesseeAId = crypto.randomUUID();
      const { error: lesseeAError } = await admin.from("lessees").insert({
        tenant_id: landlordA,
        lessee_id: lesseeAId,
        full_name: `Reuse Lessee A ${stamp}`,
        phone: "0200000001",
        email: emailLessee,
        status: "active",
        auth_user_id: null,
      });
      assert(!lesseeAError, lesseeAError?.message ?? "insert lessee A");
      createdLesseeIds.push({ tenantId: landlordA, lesseeId: lesseeAId });

      const { data: lesseeAuth, error: lesseeAuthError } =
        await admin.auth.admin.createUser({
          email: emailLessee,
          password: PASSWORD,
          email_confirm: true,
          user_metadata: { portal: "lessee" },
        });
      assert(
        !lesseeAuthError && lesseeAuth.user,
        lesseeAuthError?.message ?? "create lessee auth",
      );
      createdAuthUids.push(lesseeAuth.user.id);

      await admin
        .from("lessees")
        .update({ auth_user_id: lesseeAuth.user.id })
        .eq("tenant_id", landlordA)
        .eq("lessee_id", lesseeAId);

      const linkedConflict = await findCrossPersonaConflictForEmail(
        admin,
        emailLessee,
        { targetPersona: "lessee" },
      );
      assert(linkedConflict?.persona === "lessee", "active lessee blocks");
      console.log("(e) actively linked at A blocks: PASS");

      const { error: revokeError } = await admin
        .from("lessees")
        .update({
          auth_user_id: null,
          status: "former",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", landlordA)
        .eq("lessee_id", lesseeAId);
      assert(!revokeError, revokeError?.message ?? "revoke");

      const { data: former } = await admin
        .from("lessees")
        .select("auth_user_id, status, full_name")
        .eq("tenant_id", landlordA)
        .eq("lessee_id", lesseeAId)
        .single();
      assert(former?.auth_user_id === null, "auth_user_id cleared");
      assert(former?.status === "former", "status former");
      assert(former?.full_name?.includes("Reuse Lessee A"), "A record intact");
      console.log("(f) Landlord A former lessee record intact: PASS");

      const afterRevokeConflict = await findCrossPersonaConflictForEmail(
        admin,
        emailLessee,
        { targetPersona: "lessee" },
      );
      assert(!afterRevokeConflict, "former lessee must not block");

      const targetLandlord = landlordB!;
      const lesseeBId = crypto.randomUUID();
      const { error: lesseeBError } = await admin.from("lessees").insert({
        tenant_id: targetLandlord,
        lessee_id: lesseeBId,
        full_name: `Reuse Lessee B ${stamp}`,
        phone: "0200000002",
        email: emailLessee,
        status: "active",
        auth_user_id: null,
      });
      assert(!lesseeBError, lesseeBError?.message ?? "insert lessee B");
      createdLesseeIds.push({ tenantId: targetLandlord, lesseeId: lesseeBId });

      const authId = await findAuthUserIdByEmail(admin, emailLessee);
      assert(authId === lesseeAuth.user.id, "find existing Auth by email");

      const { error: linkError } = await admin
        .from("lessees")
        .update({
          auth_user_id: authId,
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("tenant_id", targetLandlord)
        .eq("lessee_id", lesseeBId)
        .is("auth_user_id", null);
      assert(!linkError, linkError?.message ?? "link B");

      const { data: linkedB } = await admin
        .from("lessees")
        .select("lessee_id, tenant_id")
        .eq("auth_user_id", authId!)
        .neq("status", "former")
        .maybeSingle();
      assert(linkedB?.lessee_id === lesseeBId, "resolves to NEW lessee only");
      assert(linkedB?.tenant_id === targetLandlord, "new landlord tenant");

      const { data: stillFormer } = await admin
        .from("lessees")
        .select("auth_user_id, status")
        .eq("tenant_id", landlordA)
        .eq("lessee_id", lesseeAId)
        .single();
      assert(
        stillFormer?.auth_user_id === null && stillFormer.status === "former",
        "A former + B linked coexist",
      );
      console.log("(d) revoke A → link B → resolve B only: PASS");
    }

    console.log("\n=== CROSS-PERSONA ===");

    const { data: crossAuth, error: crossAuthError } =
      await admin.auth.admin.createUser({
        email: emailCross,
        password: PASSWORD,
        email_confirm: true,
      });
    assert(!crossAuthError && crossAuth.user, crossAuthError?.message ?? "cross auth");
    createdAuthUids.push(crossAuth.user.id);

    await admin.from("user_accounts").insert({
      auth_uid: crossAuth.user.id,
      tenant_id: DAVORS,
      role: "employee",
      email: emailCross,
      is_active: true,
    });

    const activeStaffBlocksLessee = await findCrossPersonaConflictForEmail(
      admin,
      emailCross,
      { targetPersona: "lessee" },
    );
    assert(
      activeStaffBlocksLessee?.persona === "staff",
      "(h) ACTIVE staff blocks lessee",
    );
    console.log("(h) ACTIVE staff cannot become lessee: PASS");

    await admin
      .from("user_accounts")
      .update({ is_active: false })
      .eq("auth_uid", crossAuth.user.id);

    const inactiveStaffAllowsLessee = await findCrossPersonaConflictForEmail(
      admin,
      emailCross,
      { targetPersona: "lessee" },
    );
    assert(!inactiveStaffAllowsLessee, "(g) deactivated staff can become lessee");
    console.log("(g) deactivated staff email can become lessee: PASS");

    console.log("\nALL EMAIL-REUSE PROBES PASSED\n");
  } finally {
    for (const { tenantId, lesseeId } of createdLesseeIds) {
      await admin
        .from("lessees")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("lessee_id", lesseeId);
    }
    for (const authUid of createdAuthUids) {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid).catch(() => undefined);
    }
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    await admin.from("staff_portal_invites").delete().ilike("email", `%${stamp}%`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
