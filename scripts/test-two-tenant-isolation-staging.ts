/**
 * Two-tenant RLS isolation test (staging).
 *
 * Creates throwaway tenants A + B, seeds employees/projects/sites/income_register,
 * signs in as tenant A super_admin, asserts ZERO rows from tenant B on RLS-only
 * SELECT (no .eq("tenant_id") filter).
 *
 * Usage:
 *   npm run test:tenant-isolation
 *   npx tsx scripts/test-two-tenant-isolation-staging.ts --env-file .env.staging.local
 *
 * Cleanup runs in finally regardless of pass/fail.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID, ERP_SUITE_SIGNUP_SOURCE } from "../utils/tenant-signup";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "TwoTenantIso-Test-8Qx!";

/** Tables covered today; extend for full 62-table sweep. */
const ISOLATION_TABLES = [
  {
    table: "employees",
    select: "employee_id, tenant_id, data_notes",
    markerField: "data_notes" as const,
  },
  {
    table: "projects",
    select: "id, project_code, tenant_id, project_name",
    markerField: "project_name" as const,
  },
  {
    table: "sites",
    select: "site_code, tenant_id, site_name",
    markerField: "site_name" as const,
  },
  {
    table: "income_register",
    select: "id, tenant_id, notes, description",
    markerField: "notes" as const,
  },
] as const;

/**
 * Remaining super_admin_full_access tables from script-69 sweep — add seeds +
 * assertions here for comprehensive coverage (payroll_processing, clients,
 * attendance_register, loan_register, departments, positions, …).
 */
export const EXTENDED_ISOLATION_CANDIDATES = [
  "accounts_payable",
  "attendance_register",
  "clients",
  "departments",
  "loan_register",
  "payroll_processing",
  "positions",
  "tax_ledger_entries",
] as const;

type CleanupState = {
  tenantIds: string[];
  authUids: string[];
  subscriptionIds: string[];
  customerIds: string[];
  incomeIds: string[];
  employeeIds: Array<{ tenant_id: string; employee_id: string }>;
  siteCodes: Array<{ tenant_id: string; site_code: string }>;
  projectIds: string[];
};

const cleanup: CleanupState = {
  tenantIds: [],
  authUids: [],
  subscriptionIds: [],
  customerIds: [],
  incomeIds: [],
  employeeIds: [],
  siteCodes: [],
  projectIds: [],
};

async function createTenant(admin: SupabaseClient, label: "A" | "B", stamp: string) {
  const slug = `iso-rls-${label.toLowerCase()}-${stamp}`.slice(0, 63);
  const { data, error } = await admin
    .from("tenants")
    .insert({
      name: `ISO RLS ${label} ${stamp}`,
      slug,
      status: "active",
    })
    .select("id, slug")
    .single();
  assert(!error && data, error?.message ?? `tenant ${label} insert failed`);
  cleanup.tenantIds.push(data.id);
  return data.id as string;
}

async function ensureSubscription(
  admin: SupabaseClient,
  linkedTenantId: string,
  label: "A" | "B",
  stamp: string,
) {
  const clientId = `ISO-${label}-${stamp}`.slice(0, 32);
  const { error: customerError } = await admin.from("customers").insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: `ISO RLS ${label} ${stamp}`,
    customer_type: "digital_subscriber",
    source: ERP_SUITE_SIGNUP_SOURCE,
    status: "lead",
  });
  assert(!customerError, customerError?.message ?? "customers insert failed");
  cleanup.customerIds.push(clientId);

  const { data, error } = await admin
    .from("crm_subscriptions")
    .insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: linkedTenantId,
      subscription_status: "trialing",
      billing_waived: true,
      trial_end_date: "2099-12-31T23:59:59Z",
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "crm_subscriptions insert failed");
  cleanup.subscriptionIds.push(data.id);
}

async function createSuperAdmin(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
) {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");
  cleanup.authUids.push(authData.user.id);

  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authData.user.id,
    email,
    role: "super_admin",
    is_active: true,
    tenant_id: tenantId,
  });
  assert(!accountError, accountError?.message ?? "user_accounts insert failed");
}

async function signInAs(url: string, anon: string, email: string) {
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  assert(!error, error?.message ?? `sign-in failed for ${email}`);
  return client;
}

async function seedTenantData(
  admin: SupabaseClient,
  tenantId: string,
  label: "A" | "B",
  stamp: string,
) {
  const marker = `ISO-RLS-${label}-${stamp}`;
  const employeeId = `ISO${label}-${stamp}`.slice(0, 32);
  const staffId = `ISO-STAFF-${label}-${stamp}`.slice(0, 32);
  const projectCode = `ISO-P-${label}-${stamp}`.slice(0, 32);

  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      tenant_id: tenantId,
      project_code: projectCode,
      project_name: marker,
    })
    .select("id")
    .single();
  assert(!projectError && project, projectError?.message ?? "project seed failed");
  cleanup.projectIds.push(project.id);

  const siteCode = `ISO-S-${label}-${stamp}`.slice(0, 32);
  const { error: siteError } = await admin.from("sites").insert({
    tenant_id: tenantId,
    site_code: siteCode,
    site_name: marker,
    project_id: project.id,
  });
  assert(!siteError, siteError?.message ?? "site seed failed");
  cleanup.siteCodes.push({ tenant_id: tenantId, site_code: siteCode });

  const { error: employeeError } = await admin.from("employees").insert({
    tenant_id: tenantId,
    employee_id: employeeId,
    staff_id: staffId,
    full_name: `Isolation ${label}`,
    employment_type: "Permanent",
    employment_status: "Active",
    data_notes: marker,
  });
  assert(!employeeError, employeeError?.message ?? "employee seed failed");
  cleanup.employeeIds.push({ tenant_id: tenantId, employee_id: employeeId });

  const { data: income, error: incomeError } = await admin
    .from("income_register")
    .insert({
      tenant_id: tenantId,
      date: "2026-08-01",
      amount: label === "A" ? 111 : 222,
      amount_received: 0,
      entry_type: "service",
      customer_name: `ISO ${label}`,
      description: marker,
      notes: marker,
    })
    .select("id")
    .single();
  assert(!incomeError && income, incomeError?.message ?? "income seed failed");
  cleanup.incomeIds.push(income.id);

  return { marker, employeeId, projectCode, siteCode };
}

async function assertTableIsolation(
  client: SupabaseClient,
  table: (typeof ISOLATION_TABLES)[number]["table"],
  select: string,
  markerField: string,
  tenantAId: string,
  tenantBId: string,
  markerA: string,
  markerB: string,
) {
  const { data, error } = await client.from(table).select(select);
  assert(!error, `${table} read failed: ${error?.message}`);

  const rows = data ?? [];
  const foreignTenant = rows.filter(
    (row) => (row as { tenant_id?: string }).tenant_id === tenantBId,
  );
  const foreignMarker = rows.filter((row) => {
    const value = String((row as unknown as Record<string, unknown>)[markerField] ?? "");
    return value.includes(markerB);
  });

  assert(
    foreignTenant.length === 0,
    `LEAK: tenant A super_admin saw ${foreignTenant.length} ${table} row(s) with tenant B id`,
  );
  assert(
    foreignMarker.length === 0,
    `LEAK: tenant A super_admin saw ${foreignMarker.length} ${table} row(s) with tenant B marker`,
  );

  const ownMarker = rows.filter((row) => {
    const value = String((row as unknown as Record<string, unknown>)[markerField] ?? "");
    return value.includes(markerA);
  });
  assert(
    ownMarker.length >= 1,
    `Tenant A super_admin cannot see own ${table} seed row (RLS too strict?)`,
  );

  assert(
    rows.every(
      (row) =>
        !(row as { tenant_id?: string }).tenant_id ||
        (row as { tenant_id?: string }).tenant_id === tenantAId,
    ),
    `LEAK: ${table} returned rows outside tenant A`,
  );

  console.log(
    `PASS ${table}: ${rows.length} visible row(s), 0 from tenant B, own seed present`,
  );
}

async function runCleanup(admin: SupabaseClient) {
  for (const id of cleanup.incomeIds) {
    await admin.from("income_register").delete().eq("id", id);
  }
  for (const row of cleanup.employeeIds) {
    await admin
      .from("employees")
      .delete()
      .eq("tenant_id", row.tenant_id)
      .eq("employee_id", row.employee_id);
  }
  for (const row of cleanup.siteCodes) {
    await admin
      .from("sites")
      .delete()
      .eq("tenant_id", row.tenant_id)
      .eq("site_code", row.site_code);
  }
  for (const id of cleanup.projectIds) {
    await admin.from("projects").delete().eq("id", id);
  }
  for (const id of cleanup.subscriptionIds) {
    await admin.from("crm_subscriptions").delete().eq("id", id);
  }
  for (const clientId of cleanup.customerIds) {
    await admin
      .from("customers")
      .delete()
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("client_id", clientId);
  }
  for (const authUid of cleanup.authUids) {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }
  for (const tenantId of cleanup.tenantIds) {
    await admin.from("tenants").delete().eq("id", tenantId);
  }
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";

  assert(url.includes(STAGING_REF), `Refusing non-staging (loaded ${envFile})`);
  assert(serviceKey && anon, "Missing Supabase keys");

  const stamp = Date.now().toString(36);
  const emailA = `iso.rls.a.${stamp}@test.davors`;
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let tenantAId = "";
  let tenantBId = "";
  let markerA = "";
  let markerB = "";

  try {
    tenantAId = await createTenant(admin, "A", stamp);
    tenantBId = await createTenant(admin, "B", stamp);
    await ensureSubscription(admin, tenantAId, "A", stamp);
    await ensureSubscription(admin, tenantBId, "B", stamp);
    await createSuperAdmin(admin, tenantAId, emailA);

    const seedA = await seedTenantData(admin, tenantAId, "A", stamp);
    const seedB = await seedTenantData(admin, tenantBId, "B", stamp);
    markerA = seedA.marker;
    markerB = seedB.marker;
    console.log(`Seeded tenants A=${tenantAId} B=${tenantBId}`);

    const clientA = await signInAs(url, anon, emailA);

    for (const cfg of ISOLATION_TABLES) {
      await assertTableIsolation(
        clientA,
        cfg.table,
        cfg.select,
        cfg.markerField,
        tenantAId,
        tenantBId,
        markerA,
        markerB,
      );
    }

    console.log("\nALL PASS — two-tenant RLS isolation (employees, projects, sites, income_register)");
    console.log(
      `Note: extend ISOLATION_TABLES / ${EXTENDED_ISOLATION_CANDIDATES.length} other tables for full sweep.`,
    );
  } finally {
    await runCleanup(admin);
    console.log("Cleanup done");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
