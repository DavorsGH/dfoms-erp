/**
 * Staging probe: lessee portal invite email asymmetry when Auth user already exists.
 * Does not commit. Cleans up ephemeral rows.
 *
 *   npx tsx scripts/_probe-lessee-invite-auth-exists-asymmetry-staging.ts
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "InviteAsym-Probe-8Qx!";
const stamp = Date.now().toString(36);
const PROBE_EMAIL = `invite.asym.${stamp}@davors-probe.test`;

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") {
    return {};
  }
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
};

async function cleanup(admin: SupabaseClient, created: Created) {
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

async function latestInvite(
  admin: SupabaseClient,
  tenantId: string,
  lesseeId: string,
) {
  const { data, error } = await admin
    .from("lessee_portal_invites")
    .select("id, tenant_id, lessee_id, email, expires_at, used_at, created_at, token_hash")
    .eq("tenant_id", tenantId)
    .eq("lessee_id", lesseeId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { data, error };
}

async function listResendEmails(apiKey: string, limit = 20) {
  const url = `https://api.resend.com/emails?limit=${limit}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }
  return { status: response.status, ok: response.ok, body: parsed };
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const resendKey = (process.env.RESEND_API_KEY ?? "").trim();

  assert(url.includes(STAGING_REF), `Expected staging ${STAGING_REF}, got ${url}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(resendKey, "Missing RESEND_API_KEY");

  console.log("=== ENV OK ===");
  console.log({
    supabaseUrl: url,
    resendKeyLen: resendKey.length,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? null,
  });

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Instrument sendResendEmail before importing invite helper
  const resendMod = await import("../utils/resend-email");
  const resendCalls: Array<{
    to: string;
    subject: string;
    result: Awaited<ReturnType<typeof resendMod.sendResendEmail>>;
  }> = [];
  const originalSend = resendMod.sendResendEmail;
  (resendMod as { sendResendEmail: typeof originalSend }).sendResendEmail =
    async (options) => {
      const result = await originalSend(options);
      resendCalls.push({
        to: options.to,
        subject: options.subject,
        result,
      });
      console.log("[instrument] sendResendEmail called", {
        to: options.to,
        subject: options.subject,
        result,
      });
      return result;
    };

  const { createAndSendLesseePortalInvite } = await import(
    "../utils/lessee-portal-invite"
  );
  const { revokeLesseePortalAccess } = await import("../utils/email-reuse");

  // Two distinct landlord tenants
  const { data: landlords, error: landlordsError } = await admin
    .from("landlords")
    .select("tenant_id")
    .not("tenant_id", "is", null)
    .limit(10);
  assert(!landlordsError, landlordsError?.message ?? "landlords query");
  const tenantIds = [
    ...new Set(
      (landlords ?? [])
        .map((r) => r.tenant_id as string)
        .filter(Boolean),
    ),
  ];
  assert(tenantIds.length >= 2, `Need >=2 landlord tenants, found ${tenantIds.length}`);
  const tenantA = tenantIds[0]!;
  const tenantB = tenantIds[1]!;
  console.log("=== TENANTS ===", { tenantA, tenantB });

  const lesseeA = crypto.randomUUID();
  const lesseeB = crypto.randomUUID();
  const created: Created = {
    lesseeIds: [
      { tenantId: tenantA, lesseeId: lesseeA },
      { tenantId: tenantB, lesseeId: lesseeB },
    ],
    authUids: [],
  };

  try {
    // Code-path analysis (static)
    console.log("\n=== STATIC CODE FINDING ===");
    console.log(
      "createAndSendLesseePortalInvite skip branches: auth_user_id set | no email | cross-persona | !isResendConfigured. NO branch skips send merely because Auth user exists for email.",
    );

    // Create Auth user first (exists before invites)
    const { data: authCreated, error: authError } =
      await admin.auth.admin.createUser({
        email: PROBE_EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { portal: "lessee", probe: stamp },
      });
    assert(!authError && authCreated.user, authError?.message ?? "createUser");
    const authUid = authCreated.user.id;
    created.authUids.push(authUid);
    console.log("\n=== AUTH USER CREATED ===", { authUid, email: PROBE_EMAIL });

    // Lessee A under tenant A, link Auth, active
    const { error: insertA } = await admin.from("lessees").insert({
      tenant_id: tenantA,
      lessee_id: lesseeA,
      full_name: `Invite Asym A ${stamp}`,
      phone: "0200000001",
      email: PROBE_EMAIL,
      status: "active",
      auth_user_id: authUid,
    });
    assert(!insertA, insertA?.message ?? "insert lessee A");
    console.log("=== LESSEE A LINKED ===", { lesseeA, tenantA, authUid });

    // Revoke A
    const revoke = await revokeLesseePortalAccess(admin, {
      tenantId: tenantA,
      lesseeId: lesseeA,
    });
    console.log("=== REVOKE A ===", revoke);
    assert(revoke.ok, revoke.ok ? "" : revoke.error);

    const { data: afterRevoke } = await admin
      .from("lessees")
      .select("lessee_id, auth_user_id, status, email")
      .eq("tenant_id", tenantA)
      .eq("lessee_id", lesseeA)
      .maybeSingle();
    console.log("=== LESSEE A AFTER REVOKE ===", afterRevoke);

    // Confirm Auth still exists
    const { data: authStill, error: authStillErr } =
      await admin.auth.admin.getUserById(authUid);
    console.log("=== AUTH STILL EXISTS ===", {
      ok: !authStillErr && Boolean(authStill.user),
      email: authStill.user?.email,
      id: authStill.user?.id,
    });

    // Re-invite A (former landlord re-invite) — Auth exists, auth_user_id null
    resendCalls.length = 0;
    const inviteA = await createAndSendLesseePortalInvite(admin, {
      tenantId: tenantA,
      lesseeId: lesseeA,
    });
    console.log("\n=== INVITE A (re-invite, Auth exists) ===", inviteA);
    console.log("=== RESEND CALLS FOR A ===", JSON.stringify(resendCalls, null, 2));
    const inviteRowA = await latestInvite(admin, tenantA, lesseeA);
    console.log("=== INVITE ROW A ===", inviteRowA);

    // Lessee B under different tenant, same email, auth null
    const { error: insertB } = await admin.from("lessees").insert({
      tenant_id: tenantB,
      lessee_id: lesseeB,
      full_name: `Invite Asym B ${stamp}`,
      phone: "0200000002",
      email: PROBE_EMAIL,
      status: "active",
      auth_user_id: null,
    });
    assert(!insertB, insertB?.message ?? "insert lessee B");
    console.log("\n=== LESSEE B CREATED ===", { lesseeB, tenantB });

    resendCalls.length = 0;
    const inviteB = await createAndSendLesseePortalInvite(admin, {
      tenantId: tenantB,
      lesseeId: lesseeB,
    });
    console.log("=== INVITE B (new landlord, Auth exists) ===", inviteB);
    console.log("=== RESEND CALLS FOR B ===", JSON.stringify(resendCalls, null, 2));
    const inviteRowB = await latestInvite(admin, tenantB, lesseeB);
    console.log("=== INVITE ROW B ===", inviteRowB);

    // Resend list API
    console.log("\n=== RESEND LIST API ===");
    const listed = await listResendEmails(resendKey, 20);
    console.log("status", listed.status, "ok", listed.ok);
    const body = listed.body as {
      data?: Array<{ id?: string; to?: string[]; subject?: string; created_at?: string }>;
      message?: string;
    };
    if (Array.isArray(body?.data)) {
      const matched = body.data.filter((e) =>
        (e.to ?? []).some((t) => t.toLowerCase() === PROBE_EMAIL.toLowerCase()),
      );
      console.log("matched emails for probe address:", matched.length);
      console.log(JSON.stringify(matched, null, 2));
      console.log(
        "recent subjects sample:",
        body.data.slice(0, 5).map((e) => ({
          id: e.id,
          to: e.to,
          subject: e.subject,
          created_at: e.created_at,
        })),
      );
    } else {
      console.log("list body:", JSON.stringify(listed.body, null, 2).slice(0, 2000));
    }

    console.log("\n=== SUMMARY ===");
    console.log({
      email: PROBE_EMAIL,
      authUid,
      inviteA,
      inviteB,
      inviteA_tenant: inviteRowA.data?.tenant_id ?? null,
      inviteB_tenant: inviteRowB.data?.tenant_id ?? null,
    });
  } finally {
    console.log("\n=== CLEANUP ===");
    await cleanup(admin, created);
    console.log("cleanup done");
  }
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});
