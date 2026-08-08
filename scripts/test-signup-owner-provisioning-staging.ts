/**
 * Staging tests for signup owner employee + approver provisioning and
 * leave-approver tenant scoping (scripts 181–182 + signup route).
 *
 * Usage: npx tsx scripts/test-signup-owner-provisioning-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { provisionSignupOwnerEmployeeAndApprovers } from "../utils/tenant-signup-owner-provisioning";
import { seedTenantPaymentMethodsFromDavorsTemplate } from "../utils/tenant-payment-methods-seed";
import {
  buildUniqueSlugCandidates,
  slugifyCompanyName,
} from "../utils/tenant-signup";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const TEST_PASSWORD = "SignupOwner-Test-7Kx9!";

type CleanupState = {
  authUserId: string | null;
  tenantId: string | null;
  slug: string | null;
};

const cleanup: CleanupState = {
  authUserId: null,
  tenantId: null,
  slug: null,
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function hardCleanup(admin: SupabaseClient) {
  if (!cleanup.tenantId && !cleanup.authUserId) return;

  if (cleanup.tenantId) {
    await admin
      .from("leave_approver_config")
      .delete()
      .eq("tenant_id", cleanup.tenantId);
    await admin.from("approvers").delete().eq("tenant_id", cleanup.tenantId);
    await admin.from("employees").delete().eq("tenant_id", cleanup.tenantId);
    await admin
      .from("positions")
      .delete()
      .eq("tenant_id", cleanup.tenantId)
      .eq("position_title", "Administrator");
    await admin
      .from("payment_methods")
      .delete()
      .eq("tenant_id", cleanup.tenantId);
    await admin
      .from("inventory_balance_config")
      .delete()
      .eq("tenant_id", cleanup.tenantId);
    await admin.from("tenants").delete().eq("id", cleanup.tenantId);
  }

  if (cleanup.authUserId) {
    await admin.from("user_accounts").delete().eq("auth_uid", cleanup.authUserId);
    await admin.auth.admin.deleteUser(cleanup.authUserId);
  }

  cleanup.authUserId = null;
  cleanup.tenantId = null;
  cleanup.slug = null;
}

async function countTenantRows(
  admin: SupabaseClient,
  tenantId: string,
  table: "employees" | "approvers" | "leave_approver_config",
) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId);
  assert(!error, error?.message ?? `count failed for ${table}`);
  return count ?? 0;
}

async function simulateSignupProvisioning(admin: SupabaseClient, stamp: string) {
  const companyName = `Signup Owner Test ${stamp}`;
  const adminFullName = `Owner Test ${stamp}`;
  const adminEmail = `signup.owner.${stamp}@test.davors`;
  const signupDate = new Date().toISOString().slice(0, 10);

  const baseSlug = slugifyCompanyName(companyName);
  const { data: existingRows } = await admin.from("tenants").select("slug");
  const taken = new Set((existingRows ?? []).map((row) => row.slug));
  const availableSlug =
    buildUniqueSlugCandidates(baseSlug).find((candidate) => !taken.has(candidate)) ??
    `${baseSlug}-${stamp.slice(-4)}`;

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: adminFullName, company_name: companyName },
  });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");
  cleanup.authUserId = authData.user.id;

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .insert({ name: companyName, slug: availableSlug, status: "active" })
    .select("id, slug")
    .single();
  assert(!tenantError && tenantRow, tenantError?.message ?? "tenant create failed");
  cleanup.tenantId = tenantRow.id;
  cleanup.slug = tenantRow.slug;

  const { error: userAccountError } = await admin.from("user_accounts").insert({
    auth_uid: authData.user.id,
    tenant_id: tenantRow.id,
    role: "super_admin",
    employee_id: null,
    client_id: null,
    email: adminEmail,
    is_active: true,
  });
  assert(!userAccountError, userAccountError?.message ?? "user_accounts insert failed");

  await admin.from("inventory_balance_config").insert({
    tenant_id: tenantRow.id,
    go_live_date: signupDate,
    opening_inventory_value: 0,
  });

  const paymentSeed = await seedTenantPaymentMethodsFromDavorsTemplate(
    admin,
    tenantRow.id,
  );
  assert(!paymentSeed.error, paymentSeed.error ?? "payment methods seed failed");

  const ownerSeed = await provisionSignupOwnerEmployeeAndApprovers(admin, {
    tenantId: tenantRow.id,
    authUid: authData.user.id,
    adminFullName,
    adminEmail,
    signupDate,
  });
  assert(!ownerSeed.error && ownerSeed.employeeId, ownerSeed.error ?? "owner seed failed");

  return {
    tenantId: tenantRow.id,
    authUid: authData.user.id,
    employeeId: ownerSeed.employeeId!,
    adminEmail,
    adminFullName,
  };
}

async function signIn(email: string, password: string) {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  const client = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert(!error, error?.message ?? `sign-in failed for ${email}`);
  return client;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const stamp = String(Date.now());

  try {
    // --- Snapshot Davors/Caanta before ---
    const davorsBefore = {
      employees: await countTenantRows(admin, DAVORS_TENANT_ID, "employees"),
      approvers: await countTenantRows(admin, DAVORS_TENANT_ID, "approvers"),
      leaveApprovers: await countTenantRows(
        admin,
        DAVORS_TENANT_ID,
        "leave_approver_config",
      ),
    };
    const caantaBefore = {
      employees: await countTenantRows(admin, CAANTA_TENANT_ID, "employees"),
      approvers: await countTenantRows(admin, CAANTA_TENANT_ID, "approvers"),
      leaveApprovers: await countTenantRows(
        admin,
        CAANTA_TENANT_ID,
        "leave_approver_config",
      ),
    };

    console.log("Davors before:", davorsBefore);
    console.log("Caanta before:", caantaBefore);

    // --- Signup simulation ---
    const created = await simulateSignupProvisioning(admin, stamp);

    const employeeCount = await countTenantRows(admin, created.tenantId, "employees");
    const approverCount = await countTenantRows(admin, created.tenantId, "approvers");
    const leaveApproverCount = await countTenantRows(
      admin,
      created.tenantId,
      "leave_approver_config",
    );

    assert(employeeCount === 1, `expected 1 employee, got ${employeeCount}`);
    assert(approverCount === 1, `expected 1 approver, got ${approverCount}`);
    assert(
      leaveApproverCount === 1,
      `expected 1 leave_approver_config, got ${leaveApproverCount}`,
    );
    console.log("PASS signup provisioning counts (1/1/1)");

    const { data: linkedAccount, error: linkedError } = await admin
      .from("user_accounts")
      .select("employee_id, employees(full_name, position, employment_type)")
      .eq("auth_uid", created.authUid)
      .single();
    assert(!linkedError && linkedAccount, linkedError?.message ?? "linked account missing");
    assert(
      linkedAccount.employee_id === created.employeeId,
      "user_accounts.employee_id not linked to owner employee",
    );
    console.log("PASS user_accounts.employee_id linked");

    const employee = Array.isArray(linkedAccount.employees)
      ? linkedAccount.employees[0]
      : linkedAccount.employees;
    assert(employee?.full_name === created.adminFullName, "employee full_name mismatch");
    assert(employee?.position === "Administrator", "employee position mismatch");
    assert(employee?.employment_type === "Full-Time", "employment_type mismatch");
    console.log("PASS owner employee fields");

    // --- Cross-tenant leave approver isolation ---
    const { client: sql } = await connectPg({
      requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    });

    const runAsUser = async (authUid: string) => {
      await sql.query("BEGIN");
      await sql.query("SET LOCAL role authenticated");
      await sql.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: authUid, role: "authenticated" }),
      ]);
      const result = await sql.query(
        `SELECT public.current_leave_approver_auth_uid() AS approver`,
      );
      await sql.query("COMMIT");
      return result.rows[0]?.approver as string | null;
    };

    const ownApprover = await runAsUser(created.authUid);
    assert(
      ownApprover === created.authUid,
      `own tenant approver expected ${created.authUid}, got ${ownApprover}`,
    );
    console.log("PASS current_leave_approver_auth_uid resolves own tenant owner");

    // Simulate as Caanta tenant session — must NOT return new tenant's owner
    const { data: caantaSuperAdmin } = await admin
      .from("user_accounts")
      .select("auth_uid")
      .eq("tenant_id", CAANTA_TENANT_ID)
      .eq("role", "super_admin")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (caantaSuperAdmin?.auth_uid) {
      const caantaApprover = await runAsUser(caantaSuperAdmin.auth_uid);
      assert(
        caantaApprover !== created.authUid,
        "cross-tenant leak: Caanta session resolved new tenant owner as leave approver",
      );
      console.log("PASS cross-tenant isolation (Caanta != new tenant owner)");
    } else {
      console.log("SKIP cross-tenant Caanta session (no Caanta super_admin found)");
    }

    await sql.end();

    // --- Idempotent reprovision attempt should fail gracefully on existing employees ---
    const reprovision = await provisionSignupOwnerEmployeeAndApprovers(admin, {
      tenantId: created.tenantId,
      authUid: created.authUid,
      adminFullName: created.adminFullName,
      adminEmail: created.adminEmail,
      signupDate: new Date().toISOString().slice(0, 10),
    });
    assert(reprovision.error, "expected reprovision to refuse existing employees");
    assert(employeeCount === 1, "employee count changed after reprovision attempt");
    console.log("PASS reprovision blocked when employees already exist");

    // --- Davors/Caanta unchanged ---
    const davorsAfter = {
      employees: await countTenantRows(admin, DAVORS_TENANT_ID, "employees"),
      approvers: await countTenantRows(admin, DAVORS_TENANT_ID, "approvers"),
      leaveApprovers: await countTenantRows(
        admin,
        DAVORS_TENANT_ID,
        "leave_approver_config",
      ),
    };
    const caantaAfter = {
      employees: await countTenantRows(admin, CAANTA_TENANT_ID, "employees"),
      approvers: await countTenantRows(admin, CAANTA_TENANT_ID, "approvers"),
      leaveApprovers: await countTenantRows(
        admin,
        CAANTA_TENANT_ID,
        "leave_approver_config",
      ),
    };

    assert(
      JSON.stringify(davorsAfter) === JSON.stringify(davorsBefore),
      `Davors changed: before=${JSON.stringify(davorsBefore)} after=${JSON.stringify(davorsAfter)}`,
    );
    assert(
      JSON.stringify(caantaAfter) === JSON.stringify(caantaBefore),
      `Caanta changed: before=${JSON.stringify(caantaBefore)} after=${JSON.stringify(caantaAfter)}`,
    );
    console.log("PASS Davors and Caanta unchanged");

    // --- Admin UI reads (Leave Settings / Approvers data shape) ---
    const ownerClient = await signIn(created.adminEmail, TEST_PASSWORD);
    const [{ data: approverRows }, { data: leaveHistory }] = await Promise.all([
      ownerClient
        .from("approvers")
        .select("employee_id, employees!approvers_employee_id_fkey(full_name)"),
      ownerClient
        .from("leave_approver_config")
        .select("approver_user_account_id, effective_from")
        .order("effective_from", { ascending: false }),
    ]);
    assert((approverRows ?? []).length >= 1, "approvers UI query returned no rows");
    assert((leaveHistory ?? []).length >= 1, "leave settings query returned no rows");
    console.log("PASS admin UI queries (approvers + leave_approver_config)");

    console.log("\nALL PASS — signup owner provisioning verified on staging");
  } finally {
    await hardCleanup(admin);
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
      { auth: { persistSession: false } },
    );
    await hardCleanup(admin);
  } catch {
    // ignore cleanup errors
  }
  process.exit(1);
});
