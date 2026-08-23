/**
 * Staging regression: lessee portal invite when Auth already exists (Landlord A revoke → Landlord B invite).
 *
 *   npx tsx scripts/_test-lessee-invite-auth-reuse-staging.ts
 *
 * Asserts:
 * - A re-invite after revoke: status sent + Resend id + invite under A's tenant
 * - B invite same email (Auth exists): status sent + Resend id + invite under B's tenant
 * - Accept B invite links auth to B's lessee only
 * - Portal leases for that auth show only B (when A has no active linked lessee)
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "InviteReuse-Test-8Qx!";
const stamp = Date.now().toString(36);
const EMAIL = `invite.reuse.${stamp}@davors-probe.test`;

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

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

type Created = {
  lesseeIds: Array<{ tenantId: string; lesseeId: string }>;
  authUids: string[];
  leaseIds: Array<{ tenantId: string; leaseId: string }>;
};

async function cleanup(admin: SupabaseClient, created: Created) {
  for (const row of created.leaseIds) {
    await admin
      .from("leases")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lease_id", row.leaseId);
  }
  for (const row of created.lesseeIds) {
    await admin
      .from("lessee_portal_invites")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lessee_id", row.lesseeId);
    await admin
      .from("lessees")
      .delete()
      .eq("tenant_id", row.tenantId)
      .eq("lessee_id", row.lesseeId);
  }
  for (const uid of created.authUids) {
    await admin.auth.admin.deleteUser(uid).catch(() => undefined);
  }
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ${STAGING_REF}, got ${url}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(
    (process.env.RESEND_API_KEY ?? "").trim(),
    "Missing RESEND_API_KEY",
  );

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { createAndSendLesseePortalInvite } = await import(
    "../utils/lessee-portal-invite"
  );
  const { revokeLesseePortalAccess } = await import("../utils/email-reuse");

  const { data: landlords, error: landlordsError } = await admin
    .from("landlords")
    .select("tenant_id")
    .not("tenant_id", "is", null)
    .limit(10);
  assert(!landlordsError, landlordsError?.message ?? "landlords");
  const tenantIds = [
    ...new Set(
      (landlords ?? []).map((r) => r.tenant_id as string).filter(Boolean),
    ),
  ];
  assert(tenantIds.length >= 2, `Need >=2 landlords, found ${tenantIds.length}`);
  const tenantA = tenantIds[0]!;
  const tenantB = tenantIds[1]!;

  const lesseeA = crypto.randomUUID();
  const lesseeB = crypto.randomUUID();
  const created: Created = {
    lesseeIds: [
      { tenantId: tenantA, lesseeId: lesseeA },
      { tenantId: tenantB, lesseeId: lesseeB },
    ],
    authUids: [],
    leaseIds: [],
  };

  try {
    const { data: authCreated, error: authError } =
      await admin.auth.admin.createUser({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { portal: "lessee", probe: stamp },
      });
    assert(!authError && authCreated.user, authError?.message ?? "createUser");
    const authUid = authCreated.user.id;
    created.authUids.push(authUid);

    const { error: insertA } = await admin.from("lessees").insert({
      tenant_id: tenantA,
      lessee_id: lesseeA,
      full_name: `Invite Reuse A ${stamp}`,
      phone: "0200000001",
      email: EMAIL,
      status: "active",
      auth_user_id: authUid,
    });
    assert(!insertA, insertA?.message ?? "insert A");

    const revoke = await revokeLesseePortalAccess(admin, {
      tenantId: tenantA,
      lesseeId: lesseeA,
    });
    assert(revoke.ok, revoke.ok ? "" : revoke.error);

    const inviteA = await createAndSendLesseePortalInvite(admin, {
      tenantId: tenantA,
      lesseeId: lesseeA,
    });
    console.log("INVITE A (former landlord re-invite)", inviteA);
    assert(inviteA.ok, inviteA.ok ? "" : inviteA.error);
    assert(inviteA.status === "sent", `A expected sent, got ${inviteA.status}`);
    assert(inviteA.existingAuthAccount === true, "A should detect existing Auth");
    assert(inviteA.resendId.length > 0, "A missing resendId");

    const { data: rowA } = await admin
      .from("lessee_portal_invites")
      .select("tenant_id, lessee_id, email, token_hash")
      .eq("tenant_id", tenantA)
      .eq("lessee_id", lesseeA)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assert(rowA?.tenant_id === tenantA, "A invite wrong tenant");
    assert(rowA?.email === EMAIL, "A invite wrong email");

    const { error: insertB } = await admin.from("lessees").insert({
      tenant_id: tenantB,
      lessee_id: lesseeB,
      full_name: `Invite Reuse B ${stamp}`,
      phone: "0200000002",
      email: EMAIL,
      status: "active",
      auth_user_id: null,
    });
    assert(!insertB, insertB?.message ?? "insert B");

    const inviteB = await createAndSendLesseePortalInvite(admin, {
      tenantId: tenantB,
      lesseeId: lesseeB,
    });
    console.log("INVITE B (new landlord, Auth exists)", inviteB);
    assert(inviteB.ok, inviteB.ok ? "" : inviteB.error);
    assert(inviteB.status === "sent", `B expected sent, got ${inviteB.status}`);
    assert(inviteB.existingAuthAccount === true, "B should detect existing Auth");
    assert(inviteB.resendId.length > 0, "B missing resendId");
    assert(
      inviteB.resendId !== inviteA.resendId,
      "B should get a distinct Resend message id",
    );

    const { data: rowB } = await admin
      .from("lessee_portal_invites")
      .select("tenant_id, lessee_id, email, token_hash, invite_id")
      .eq("tenant_id", tenantB)
      .eq("lessee_id", lesseeB)
      .is("used_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assert(rowB?.tenant_id === tenantB, "B invite must be under landlord B tenant");
    assert(rowB?.lessee_id === lesseeB, "B invite wrong lessee");
    assert(rowB?.email === EMAIL, "B invite wrong email");

    // Simulate accept: link existing Auth to B (same as accept-invite existing-Auth branch)
    const nowIso = new Date().toISOString();
    const { error: linkError } = await admin
      .from("lessees")
      .update({
        auth_user_id: authUid,
        status: "active",
        updated_at: nowIso,
      })
      .eq("tenant_id", tenantB)
      .eq("lessee_id", lesseeB)
      .is("auth_user_id", null);
    assert(!linkError, linkError?.message ?? "link B");

    await admin
      .from("lessee_portal_invites")
      .update({ used_at: nowIso })
      .eq("invite_id", rowB!.invite_id);

    const { data: linked } = await admin
      .from("lessees")
      .select("tenant_id, lessee_id, auth_user_id, status")
      .eq("auth_user_id", authUid);
    const activeLinked = (linked ?? []).filter((r) => r.status !== "former");
    assert(
      activeLinked.length === 1 && activeLinked[0]?.tenant_id === tenantB,
      `Expected only B linked actively, got ${JSON.stringify(activeLinked)}`,
    );

    const { data: aAfter } = await admin
      .from("lessees")
      .select("auth_user_id, status")
      .eq("tenant_id", tenantA)
      .eq("lessee_id", lesseeA)
      .maybeSingle();
    assert(aAfter?.auth_user_id == null, "A must remain unlinked");
    assert(aAfter?.status === "former", "A must remain former");

    console.log("PASS — A re-invite + B invite both sent; B invite scoped to B; accept links only B");
  } finally {
    await cleanup(admin, created);
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
