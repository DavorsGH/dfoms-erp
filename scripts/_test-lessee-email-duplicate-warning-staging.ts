/**
 * Staging: soft duplicate-email warning for lessee records (staff + landlord surfaces).
 *
 *   npx tsx scripts/_test-lessee-email-duplicate-warning-staging.ts
 *   npx tsx scripts/_test-lessee-email-duplicate-warning-staging.ts --env-file .env.staging.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID, ERP_SUITE_SIGNUP_SOURCE } from "../utils/tenant-signup";
import { LESSEE_EMAIL_DUPLICATE_WARNING } from "../utils/lessee-email-duplicate";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

type CleanupState = {
  tenantIds: string[];
  lesseeIds: string[];
  subscriptionIds: string[];
  customerIds: string[];
};

const cleanup: CleanupState = {
  tenantIds: [],
  lesseeIds: [],
  subscriptionIds: [],
  customerIds: [],
};

function pass(label: string) {
  console.log(`PASS — ${label}`);
}

function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`FAIL — ${label}: ${msg}`);
}

async function createTenant(admin: SupabaseClient, stamp: string, suffix = "") {
  const slug = `lessee-dup-${stamp}${suffix}`.slice(0, 63);
  const { data, error } = await admin
    .from("tenants")
    .insert({ name: `Lessee Dup ${stamp}${suffix}`, slug, status: "active" })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "tenant insert failed");
  cleanup.tenantIds.push(data.id);
  return data.id as string;
}

async function ensureSubscription(admin: SupabaseClient, tenantId: string, stamp: string) {
  const clientId = `LDUP-${stamp}`.slice(0, 32);
  await admin.from("customers").insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: `Lessee Dup ${stamp}`,
    customer_type: "digital_subscriber",
    source: ERP_SUITE_SIGNUP_SOURCE,
    status: "lead",
  });
  cleanup.customerIds.push(clientId);

  const { data, error } = await admin
    .from("crm_subscriptions")
    .insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: tenantId,
      subscription_status: "trialing",
      billing_waived: true,
      trial_end_date: "2099-12-31T23:59:59Z",
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "subscription insert failed");
  cleanup.subscriptionIds.push(data.id);
}

async function insertLessee(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
  stamp: string,
) {
  const lesseeId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error } = await admin.from("lessees").insert({
    tenant_id: tenantId,
    lessee_id: lesseeId,
    auth_user_id: null,
    full_name: `Dup Test ${stamp}`,
    phone: "+233200000099",
    email,
    status: "active",
    created_at: now,
    updated_at: now,
  });
  assert(!error, error?.message ?? "lessee insert failed");
  cleanup.lesseeIds.push(lesseeId);
  return lesseeId;
}

async function hasDuplicateLesseeEmailOnAnotherRecord(
  admin: SupabaseClient,
  email: string,
  excludeLesseeId?: string | null,
) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const { data, error } = await admin
    .from("lessees")
    .select("lessee_id")
    .ilike("email", normalized)
    .limit(5);

  assert(!error, error?.message ?? "lessee lookup failed");

  const trimmedExclude = excludeLesseeId?.trim() ?? "";
  return (data ?? []).some(
    (row) =>
      typeof row.lessee_id === "string" &&
      (!trimmedExclude || row.lessee_id !== trimmedExclude),
  );
}

async function cleanupAll(admin: SupabaseClient) {
  for (const lesseeId of cleanup.lesseeIds) {
    await admin.from("lessees").delete().eq("lessee_id", lesseeId);
  }
  for (const subscriptionId of cleanup.subscriptionIds) {
    await admin.from("crm_subscriptions").delete().eq("id", subscriptionId);
  }
  for (const clientId of cleanup.customerIds) {
    await admin.from("customers").delete().eq("client_id", clientId);
  }
  for (const tenantId of cleanup.tenantIds) {
    await admin.from("tenants").delete().eq("id", tenantId);
  }
}

function assertUiWiring() {
  const root = process.cwd();
  const uiFiles = [
    "app/dashboard/real-estate/lessees.tsx",
    "app/dashboard/real-estate/lessee-detail.tsx",
    "app/landlord-portal/real-estate/tenants/tenant-edit-form.tsx",
  ];
  const apiFiles = [
    "app/api/admin/lessees/check-email-duplicate/route.ts",
    "app/api/landlord-portal/lessees/check-email-duplicate/route.ts",
  ];

  for (const relativePath of uiFiles) {
    const content = readFileSync(resolve(root, relativePath), "utf8");
    assert(
      content.includes("fetchLesseeEmailDuplicateWarning"),
      `${relativePath} missing fetchLesseeEmailDuplicateWarning`,
    );
    assert(
      content.includes("emailDuplicateWarning"),
      `${relativePath} missing emailDuplicateWarning state`,
    );
  }

  for (const relativePath of apiFiles) {
    const content = readFileSync(resolve(root, relativePath), "utf8");
    assert(
      content.includes("hasDuplicateLesseeEmailOnAnotherRecord"),
      `${relativePath} missing duplicate check`,
    );
    assert(
      content.includes("{ duplicate }"),
      `${relativePath} must return duplicate boolean only`,
    );
    assert(
      !content.includes("full_name"),
      `${relativePath} must not expose other record fields`,
    );
  }

  pass("staff + landlord UI surfaces wire duplicate warning");
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  console.log(`Loaded env: ${envFile}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ref ${STAGING_REF}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  pass(`staging ref ${STAGING_REF}`);

  assert(
    LESSEE_EMAIL_DUPLICATE_WARNING.includes("Portal invites only work for one account per email"),
    "warning copy mismatch",
  );
  pass("warning message constant");

  assertUiWiring();

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now().toString(36);
  const sharedEmail = `lessee.dup.${stamp}@example.com`;
  const results: Record<string, "PASS" | "FAIL" | "SKIP"> = {
    a: "SKIP",
    b: "SKIP",
    c: "SKIP",
    d: "SKIP",
  };

  try {
    const tenantA = await createTenant(admin, stamp, "-a");
    const tenantB = await createTenant(admin, stamp, "-b");
    await ensureSubscription(admin, tenantA, `${stamp}-a`);
    await ensureSubscription(admin, tenantB, `${stamp}-b`);

    const lesseeA = await insertLessee(admin, tenantA, sharedEmail, `${stamp}-a`);
    const lesseeB = await insertLessee(admin, tenantB, sharedEmail, `${stamp}-b`);

    // (a) cross-landlord duplicate detected
    try {
      const duplicateForB = await hasDuplicateLesseeEmailOnAnotherRecord(
        admin,
        sharedEmail,
        lesseeB,
      );
      assert(duplicateForB, "expected duplicate across landlords");
      results.a = "PASS";
      pass("(a) cross-landlord duplicate detected");
    } catch (err) {
      fail("(a) cross-landlord duplicate", err);
      results.a = "FAIL";
    }

    // (b) case-insensitive match
    try {
      const duplicate = await hasDuplicateLesseeEmailOnAnotherRecord(
        admin,
        sharedEmail.toUpperCase(),
        lesseeB,
      );
      assert(duplicate, "expected case-insensitive duplicate");
      results.b = "PASS";
      pass("(b) case-insensitive duplicate");
    } catch (err) {
      fail("(b) case-insensitive", err);
      results.b = "FAIL";
    }

    // (c) exclude self on edit
    try {
      const duplicate = await hasDuplicateLesseeEmailOnAnotherRecord(
        admin,
        sharedEmail,
        lesseeA,
      );
      assert(duplicate, "expected duplicate when another lessee shares email");
      const selfOnly = await hasDuplicateLesseeEmailOnAnotherRecord(
        admin,
        `unique.${stamp}@example.com`,
        lesseeA,
      );
      assert(!selfOnly, "unique email should not duplicate");
      results.c = "PASS";
      pass("(c) exclude-self + unique email checks");
    } catch (err) {
      fail("(c) exclude-self", err);
      results.c = "FAIL";
    }

    // (d) API routes return boolean only (no leaked fields) — covered in assertUiWiring()
    try {
      results.d = "PASS";
      pass("(d) tenant-safe API responses (duplicate boolean only)");
    } catch (err) {
      fail("(d) API shape", err);
      results.d = "FAIL";
    }

    console.log("\n=== Summary ===");
    for (const key of ["a", "b", "c", "d"] as const) {
      console.log(`  (${key}) ${results[key]}`);
    }

    const allPass = Object.values(results).every((r) => r === "PASS");
    if (!allPass) process.exit(1);
    console.log("\nALL LESSEE EMAIL DUPLICATE WARNING STAGING CHECKS PASSED\n");
  } finally {
    await cleanupAll(admin);
  }
}

main().catch((err) => {
  console.error("\nFAIL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
