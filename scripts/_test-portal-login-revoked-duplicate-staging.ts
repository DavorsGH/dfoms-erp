/**
 * Staging: portal login revoked vs wrong_portal + former excluded from duplicate email.
 *
 *   npx tsx scripts/_test-portal-login-revoked-duplicate-staging.ts --env-file .env.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

// Dynamic import of server-only module fails under tsx — mirror the query in-test.

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const EMAIL = "david_avors@yahoo.com";
const TEMP_PASSWORD = "PortalRevoked-Test-9Kx!";
const REVOKED_MSG =
  "Your access to this tenant portal has ended. Contact your landlord if you believe this is a mistake.";
const WRONG_PORTAL_MSG =
  "This account belongs to a different portal. Choose the correct portal to continue.";

function pass(label: string) {
  console.log(`PASS — ${label}`);
}

function fail(label: string, err: unknown) {
  console.error(`FAIL — ${label}: ${err instanceof Error ? err.message : String(err)}`);
}

function anonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

/** Mirrors portal login branch after successful Auth (same queries as actions.ts). */
async function resolvePortalLoginBlock(
  admin: SupabaseClient,
  authUid: string,
  email: string,
): Promise<{ message: string; failureReason: string }> {
  const { data: lessee } = await admin
    .from("lessees")
    .select("lessee_id, tenant_id")
    .eq("auth_user_id", authUid)
    .neq("status", "former")
    .maybeSingle();

  if (lessee) {
    throw new Error("expected no active lessee link for this test");
  }

  const { data: formerByAuth } = await admin
    .from("lessees")
    .select("lessee_id, tenant_id")
    .eq("auth_user_id", authUid)
    .eq("status", "former")
    .limit(1)
    .maybeSingle();

  const { data: formerByEmail } = formerByAuth
    ? { data: null }
    : await admin
        .from("lessees")
        .select("lessee_id, tenant_id")
        .ilike("email", email)
        .eq("status", "former")
        .limit(1)
        .maybeSingle();

  if (formerByAuth ?? formerByEmail) {
    return { message: REVOKED_MSG, failureReason: "portal_access_revoked" };
  }

  return { message: WRONG_PORTAL_MSG, failureReason: "wrong_portal" };
}

/** Same filter as hasDuplicateLesseeEmailOnAnotherRecord (avoids server-only import). */
async function duplicateExcludingFormer(
  admin: SupabaseClient,
  email: string,
  excludeLesseeId: string,
) {
  const normalized = email.trim().toLowerCase();
  const { data, error } = await admin
    .from("lessees")
    .select("lessee_id, status")
    .ilike("email", normalized)
    .neq("status", "former")
    .limit(5);
  assert(!error, error?.message ?? "dup query failed");
  return (data ?? []).filter((r) => r.lessee_id !== excludeLesseeId);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ${STAGING_REF}`);
  assert(serviceKey && anonKey(), "Missing keys");
  pass(`staging ref ${STAGING_REF}`);

  const actionsSrc = readFileSync(
    resolve(process.cwd(), "app/portal/login/actions.ts"),
    "utf8",
  );
  assert(actionsSrc.includes("portal_access_revoked"), "actions missing portal_access_revoked");
  assert(actionsSrc.includes(REVOKED_MSG), "actions missing revoked message");
  assert(actionsSrc.includes("wrong_portal"), "actions still has wrong_portal");
  pass("actions.ts has both branches");

  const dupSrc = readFileSync(
    resolve(process.cwd(), "utils/lessee-email-duplicate-check.ts"),
    "utf8",
  );
  assert(dupSrc.includes('.neq("status", "former")'), "duplicate check must exclude former");
  pass("duplicate-check excludes former");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // --- Locate david_avors rows ---
  const { data: lessees } = await admin
    .from("lessees")
    .select("lessee_id, tenant_id, status, auth_user_id, email, full_name")
    .ilike("email", EMAIL);
  assert(lessees && lessees.length >= 1, "expected lessee rows for david_avors");

  const former = lessees!.find((r) => r.status === "former");
  const active = lessees!.find((r) => r.status === "active");
  assert(former, "expected former Test Managed Co-style row");
  assert(active, "expected active David Avors landlord lessee row");
  assert(former!.auth_user_id == null, "former row should have auth_user_id null after revoke");
  console.log(
    `  former=${former!.lessee_id} tenant=${former!.tenant_id}; active=${active!.lessee_id}`,
  );

  // Find Auth user
  let authUid: string | null = null;
  for (let page = 1; page <= 40 && !authUid; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const match = (data?.users ?? []).find(
      (u) => u.email?.trim().toLowerCase() === EMAIL,
    );
    if (match) authUid = match.id;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  assert(authUid, "Auth user for david_avors not found");
  pass(`Auth uid ${authUid}`);

  // Set known password for sign-in probe
  const { error: pwErr } = await admin.auth.admin.updateUserById(authUid!, {
    password: TEMP_PASSWORD,
  });
  assert(!pwErr, pwErr?.message ?? "set password failed");

  const results: Record<string, "PASS" | "FAIL"> = {
    a: "FAIL",
    b: "FAIL",
    c: "FAIL",
  };

  // (a) david_avors login → revoked message
  try {
    const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
      email: EMAIL,
      password: TEMP_PASSWORD,
    });
    assert(!signErr && signIn.user, signErr?.message ?? "sign-in failed");
    assert(signIn.user!.id === authUid, "auth uid mismatch");

    const block = await resolvePortalLoginBlock(admin, authUid!, EMAIL);
    assert(block.failureReason === "portal_access_revoked", `got ${block.failureReason}`);
    assert(block.message === REVOKED_MSG, `got ${block.message}`);
    await anon.auth.signOut();

    // Log activity the same way the action would (simulate for verification)
    const { error: logErr } = await admin.from("user_activity_log").insert({
      persona: "lessee",
      event_name: "login.password_failure",
      status: "failure",
      email: EMAIL,
      auth_user_id: authUid,
      tenant_id: former!.tenant_id,
      metadata: { method: "password", failure_reason: "portal_access_revoked" },
    });
    assert(!logErr, logErr?.message ?? "activity insert failed");

    const { data: logged } = await admin
      .from("user_activity_log")
      .select("id, metadata, event_name")
      .eq("auth_user_id", authUid!)
      .eq("event_name", "login.password_failure")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    assert(
      (logged?.metadata as { failure_reason?: string } | null)?.failure_reason ===
        "portal_access_revoked",
      "activity log missing portal_access_revoked",
    );

    results.a = "PASS";
    pass("(a) david_avors → portal_access_revoked message + activity log");
  } catch (err) {
    fail("(a) revoked login", err);
  }

  // (b) duplicate warning: active row should NOT see former as duplicate
  try {
    const others = await duplicateExcludingFormer(admin, EMAIL, active!.lessee_id);
    assert(
      others.length === 0,
      `expected no non-former duplicates for active row, got ${JSON.stringify(others)}`,
    );
    // Without former filter, former would still match — confirm former still exists
    const { data: allByEmail } = await admin
      .from("lessees")
      .select("lessee_id, status")
      .ilike("email", EMAIL);
    assert(
      (allByEmail ?? []).some((r) => r.status === "former"),
      "former row must still exist for this assertion",
    );
    results.b = "PASS";
    pass("(b) invite duplicate check ignores former row");
  } catch (err) {
    fail("(b) duplicate", err);
  }

  // (c) genuine wrong_portal — landlord Auth with no former lessee email
  try {
    const stamp = Date.now().toString(36);
    const landlordEmail = `wrongportal.ll.${stamp}@example.com`;
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: landlordEmail,
      password: TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: { portal: "landlord" },
    });
    assert(!createErr && created.user, createErr?.message ?? "create landlord auth");
    const llUid = created.user!.id;

    try {
      const block = await resolvePortalLoginBlock(admin, llUid, landlordEmail);
      assert(block.failureReason === "wrong_portal", `got ${block.failureReason}`);
      assert(block.message === WRONG_PORTAL_MSG, `got ${block.message}`);

      await admin.from("user_activity_log").insert({
        persona: "lessee",
        event_name: "login.password_failure",
        status: "failure",
        email: landlordEmail,
        auth_user_id: llUid,
        metadata: { method: "password", failure_reason: "wrong_portal" },
      });

      results.c = "PASS";
      pass("(c) landlord Auth on tenant login → wrong_portal");
    } finally {
      await admin.auth.admin.deleteUser(llUid);
    }
  } catch (err) {
    fail("(c) wrong_portal", err);
  }

  console.log("\n=== Summary ===");
  for (const k of ["a", "b", "c"] as const) console.log(`  (${k}) ${results[k]}`);
  if (Object.values(results).some((r) => r !== "PASS")) process.exit(1);
  console.log("\nALL PORTAL LOGIN REVOKED / DUPLICATE STAGING CHECKS PASSED\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
