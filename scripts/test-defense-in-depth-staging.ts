/**
 * Staging functional tests for defense-in-depth audit leftovers:
 * 1) admin-user-delete tenant scoping (create → report → cross-tenant miss → delete)
 * 2) admin-user-role create + syncSupervisorSites tenant_id
 * 3) payroll-processing shared tax config queries (DAVORS_TENANT_ID)
 * 4) live change_leave_approver RPC definition analysis
 *
 * Usage: npx tsx scripts/test-defense-in-depth-staging.ts
 * Cleans up every auth/user_accounts/supervisor_sites row it creates.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  deleteUserAccount,
  getUserDeleteDependencyReport,
  validateUserCanBeDeleted,
} from "../utils/admin-user-delete";
import {
  buildUserAccountPayload,
  syncSupervisorSites,
} from "../utils/admin-user-role";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";
import {
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const TEST_PASSWORD = "DefDepth-Test-7Kx9!";
const TEST_EMAIL_SUPERVISOR = `defdepth.supervisor.${Date.now()}@test.davors`;
const TEST_EMAIL_DAVORS_HR = `defdepth.davors.hr.${Date.now()}@test.davors`;
const TEST_EMAIL_CAANTA_HR = `defdepth.caanta.hr.${Date.now()}@test.davors`;

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

type CleanupTarget = { authUid: string; tenantId: string; email: string };
const cleanupTargets: CleanupTarget[] = [];

async function hardCleanup(admin: SupabaseClient, target: CleanupTarget) {
  await admin
    .from("user_account_supervisor_sites")
    .delete()
    .eq("auth_uid", target.authUid)
    .eq("tenant_id", target.tenantId);
  await admin.from("user_accounts").delete().eq("auth_uid", target.authUid);
  await admin.auth.admin.deleteUser(target.authUid);
}

async function createAuthAndAccount(
  admin: SupabaseClient,
  opts: {
    email: string;
    password: string;
    tenantId: string;
    role: string;
    employee_id?: string | null;
    client_id?: string | null;
    supervisor_site_codes?: string[];
  },
) {
  const built = buildUserAccountPayload({
    tenant_id: opts.tenantId,
    role: opts.role,
    employee_id: opts.employee_id,
    client_id: opts.client_id,
    supervisor_site_codes: opts.supervisor_site_codes,
  });
  assert(built.ok, `payload build failed: ${JSON.stringify(built)}`);

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email: opts.email,
      password: opts.password,
      email_confirm: true,
    });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");

  const authUid = authData.user!.id;
  cleanupTargets.push({
    authUid,
    tenantId: opts.tenantId,
    email: opts.email,
  });

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    employee_id: built.payload.employee_id,
    client_id: built.payload.client_id,
    role: built.payload.role,
    email: opts.email,
    is_active: true,
    tenant_id: built.payload.tenant_id,
  });
  assert(!insertError, insertError?.message ?? "user_accounts insert failed");

  const siteSyncError = await syncSupervisorSites(
    admin,
    authUid,
    built.payload.role,
    built.supervisor_site_codes,
    opts.tenantId,
  );
  assert(!siteSyncError, siteSyncError ?? "site sync failed");

  return { authUid, built };
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert(url?.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(key, "Missing service role key");
  assert(anon, "Missing anon/publishable key");

  const admin = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results: Record<string, unknown> = {};

  try {
    // --- Discover Davors sites + free employee for supervisor ---
    const { data: sites, error: sitesError } = await admin
      .from("sites")
      .select("site_code, site_name")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .order("site_code")
      .limit(2);
    assert(!sitesError && sites && sites.length > 0, sitesError?.message ?? "No Davors sites");
    const siteCodes = sites.map((s) => s.site_code);

    const { data: accounts } = await admin
      .from("user_accounts")
      .select("employee_id")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .not("employee_id", "is", null);
    const usedEmployees = new Set(
      (accounts ?? []).map((a) => a.employee_id).filter(Boolean),
    );

    const { data: employees } = await admin
      .from("employees")
      .select("employee_id, full_name")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .order("employee_id")
      .limit(50);
    const freeEmployee = (employees ?? []).find(
      (e) => !usedEmployees.has(e.employee_id),
    );
    assert(freeEmployee, "No free Davors employee for supervisor test user");

    // ========== PART 1.2: create + supervisor sites ==========
    const created = await createAuthAndAccount(admin, {
      email: TEST_EMAIL_SUPERVISOR,
      password: TEST_PASSWORD,
      tenantId: DAVORS_TENANT_ID,
      role: "supervisor",
      employee_id: freeEmployee.employee_id,
      supervisor_site_codes: siteCodes,
    });

    const { data: accountRow } = await admin
      .from("user_accounts")
      .select("auth_uid, tenant_id, role, email, employee_id")
      .eq("auth_uid", created.authUid)
      .maybeSingle();
    const { data: siteRows } = await admin
      .from("user_account_supervisor_sites")
      .select("auth_uid, site_code, tenant_id")
      .eq("auth_uid", created.authUid);

    assert(accountRow?.tenant_id === DAVORS_TENANT_ID, "user_accounts.tenant_id mismatch");
    assert(
      (siteRows ?? []).length === siteCodes.length,
      `expected ${siteCodes.length} supervisor sites, got ${(siteRows ?? []).length}`,
    );
    assert(
      (siteRows ?? []).every((r) => r.tenant_id === DAVORS_TENANT_ID),
      "supervisor site rows missing tenant_id=Davors",
    );

    results.part1_2_create_and_sites = {
      ok: true,
      email: TEST_EMAIL_SUPERVISOR,
      auth_uid: created.authUid,
      tenant_id: accountRow?.tenant_id,
      role: accountRow?.role,
      supervisor_sites: siteRows,
    };

    // ========== PART 1.1: delete flow + tenant scoping ==========
    const wrongTenantReport = await getUserDeleteDependencyReport(
      admin,
      created.authUid,
      CAANTA_TENANT_ID,
    );
    assert(
      wrongTenantReport === null,
      "Cross-tenant delete report should be null (Caanta lookup of Davors user)",
    );

    const rightTenantReport = await getUserDeleteDependencyReport(
      admin,
      created.authUid,
      DAVORS_TENANT_ID,
    );
    assert(rightTenantReport, "Same-tenant delete report missing");
    assert(
      rightTenantReport.supervisorSiteCount === siteCodes.length,
      `supervisorSiteCount expected ${siteCodes.length}, got ${rightTenantReport.supervisorSiteCount}`,
    );

    const validation = await validateUserCanBeDeleted(
      admin,
      created.authUid,
      DAVORS_TENANT_ID,
    );
    assert(validation.ok, `validate failed: ${JSON.stringify(validation)}`);

    const deleteResult = await deleteUserAccount(
      admin,
      created.authUid,
      DAVORS_TENANT_ID,
    );
    assert(deleteResult.ok, `delete failed: ${JSON.stringify(deleteResult)}`);

    // remove from cleanup list — already deleted via deleteUserAccount
    const idx = cleanupTargets.findIndex((t) => t.authUid === created.authUid);
    if (idx >= 0) cleanupTargets.splice(idx, 1);

    const { data: accountAfter } = await admin
      .from("user_accounts")
      .select("auth_uid")
      .eq("auth_uid", created.authUid)
      .maybeSingle();
    const { data: sitesAfter } = await admin
      .from("user_account_supervisor_sites")
      .select("site_code")
      .eq("auth_uid", created.authUid);
    const { data: authUsersAfter } = await admin.auth.admin.getUserById(
      created.authUid,
    );

    results.part1_1_delete_flow = {
      ok: true,
      cross_tenant_report_null: wrongTenantReport === null,
      same_tenant_supervisor_sites: rightTenantReport.supervisorSiteCount,
      account_gone: !accountAfter,
      sites_gone: (sitesAfter ?? []).length === 0,
      auth_gone: !authUsersAfter?.user,
    };

    assert(!accountAfter, "user_accounts row still present after delete");
    assert((sitesAfter ?? []).length === 0, "supervisor sites remain after delete");
    assert(!authUsersAfter?.user, "auth user still present after delete");

    // ========== PART 1.3: payroll tax config (page query shape) ==========
    const [
      { data: ssnitRows, error: ssnitError },
      { data: casualRows, error: casualError },
      { data: payeRows, error: payeError },
    ] = await Promise.all([
      admin
        .from("ssnit_rate_config")
        .select("*")
        .eq("tenant_id", DAVORS_TENANT_ID)
        .order("effective_date", { ascending: false }),
      admin
        .from("casual_tax_rate_config")
        .select("*")
        .eq("tenant_id", DAVORS_TENANT_ID)
        .order("effective_date", { ascending: false }),
      admin
        .from("paye_tax_bands")
        .select("band_order, lower_bound, upper_bound, rate, effective_date")
        .eq("tenant_id", DAVORS_TENANT_ID)
        .order("effective_date", { ascending: false })
        .order("band_order", { ascending: true }),
    ]);

    assert(!ssnitError, ssnitError?.message ?? "ssnit error");
    assert(!casualError, casualError?.message ?? "casual error");
    assert(!payeError, payeError?.message ?? "paye error");
    assert((ssnitRows ?? []).length > 0, "No SSNIT rows for Davors shared config");
    assert((casualRows ?? []).length > 0, "No casual tax rows for Davors shared config");
    assert((payeRows ?? []).length > 0, "No PAYE bands for Davors shared config");

    const mapped = {
      ssnit: mapSsnitConfigRows((ssnitRows as Record<string, unknown>[]) ?? []),
      casual: mapCasualTaxConfigRows(
        (casualRows as Record<string, unknown>[]) ?? [],
      ),
      paye: mapPayrollPayeBandRows((payeRows as Record<string, unknown>[]) ?? []),
    };

    // Simulate "both tenants load the page" — same admin queries, both get Davors shared rates.
    // Also verify each tenant's user session can load tenant-scoped employees without error.
    async function sessionEmployeeProbe(tenantId: string, email: string) {
      const { data: freeEmpList } = await admin
        .from("employees")
        .select("employee_id")
        .eq("tenant_id", tenantId)
        .limit(20);
      const { data: used } = await admin
        .from("user_accounts")
        .select("employee_id")
        .eq("tenant_id", tenantId)
        .not("employee_id", "is", null);
      const usedSet = new Set((used ?? []).map((r) => r.employee_id));
      const free = (freeEmpList ?? []).find((e) => !usedSet.has(e.employee_id));

      // HR role does not require employee link for create payload — but role utils may.
      // Use finance role without employee if possible; check roleRequiresEmployee.
      const createdHr = await createAuthAndAccount(admin, {
        email,
        password: TEST_PASSWORD,
        tenantId,
        role: "finance",
        employee_id: free?.employee_id ?? null,
      });

      const userClient = createClient(url!, anon!, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInError } = await userClient.auth.signInWithPassword({
        email,
        password: TEST_PASSWORD,
      });
      assert(!signInError, `sign-in failed for ${email}: ${signInError?.message}`);

      const { data: empRows, error: empError } = await userClient
        .from("employees")
        .select("employee_id, staff_id, full_name")
        .order("staff_id", { ascending: true })
        .limit(5);

      // Same shared tax queries the page runs (admin + DAVORS_TENANT_ID)
      const { data: sessionSsnit, error: sessionSsnitError } = await admin
        .from("ssnit_rate_config")
        .select("effective_date, employee_rate, employer_tier1_rate")
        .eq("tenant_id", DAVORS_TENANT_ID)
        .order("effective_date", { ascending: false })
        .limit(1);

      return {
        authUid: createdHr.authUid,
        signInOk: !signInError,
        employeesError: empError?.message ?? null,
        employeesSampleCount: (empRows ?? []).length,
        sharedSsnitError: sessionSsnitError?.message ?? null,
        sharedSsnitTop: sessionSsnit?.[0] ?? null,
      };
    }

    const davorsProbe = await sessionEmployeeProbe(
      DAVORS_TENANT_ID,
      TEST_EMAIL_DAVORS_HR,
    );
    const caantaProbe = await sessionEmployeeProbe(
      CAANTA_TENANT_ID,
      TEST_EMAIL_CAANTA_HR,
    );

    assert(!davorsProbe.employeesError, `Davors employees query error: ${davorsProbe.employeesError}`);
    assert(!caantaProbe.employeesError, `Caanta employees query error: ${caantaProbe.employeesError}`);
    assert(
      JSON.stringify(davorsProbe.sharedSsnitTop) ===
        JSON.stringify(caantaProbe.sharedSsnitTop),
      "Davors and Caanta did not see identical shared SSNIT top row",
    );

    results.part1_3_payroll_tax_config = {
      ok: true,
      ssnit_count: (ssnitRows ?? []).length,
      casual_count: (casualRows ?? []).length,
      paye_count: (payeRows ?? []).length,
      mapped_ssnit_top: mapped.ssnit[0] ?? null,
      mapped_casual_top: mapped.casual[0] ?? null,
      mapped_paye_top: mapped.paye[0] ?? null,
      davors_session: davorsProbe,
      caanta_session: caantaProbe,
      shared_rates_identical: true,
    };

    // ========== PART 2: live change_leave_approver ==========
    const sql = new pg.Client({
      connectionString: resolveDatabaseUrl(),
      ssl: { rejectUnauthorized: false },
    });
    await sql.connect();
    const fn = await sql.query(`
      SELECT pg_get_functiondef(p.oid) AS def,
             p.prosecdef AS security_definer
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'change_leave_approver'
    `);
    await sql.end();

    assert(fn.rows.length >= 1, "change_leave_approver not found on staging");
    const def: string = fn.rows[0].def;
    const checksTenantOnApprover =
      /tenant_id\s*=\s*current_user_tenant_id\(\)/i.test(def) ||
      (/tenant_id/i.test(def) &&
        /p_approver_auth_uid/i.test(def) &&
        /user_accounts/i.test(def) &&
        /current_user_tenant_id|tenant_id\s*=/i.test(def));

    // More precise: does the EXISTS on user_accounts filter by caller's tenant?
    const existsBlock = def.match(
      /IF NOT EXISTS\s*\(([\s\S]*?)\)\s*THEN/i,
    )?.[1] ?? "";
    const existsChecksTenant =
      /tenant_id/i.test(existsBlock) &&
      (/current_user_tenant_id/i.test(existsBlock) ||
        /v_tenant/i.test(existsBlock));

    results.part2_change_leave_approver = {
      security_definer: fn.rows[0].security_definer,
      exists_block: existsBlock.replace(/\s+/g, " ").trim().slice(0, 400),
      exists_checks_tenant: existsChecksTenant,
      def_mentions_tenant_id: /tenant_id/i.test(def),
      def_mentions_current_user_tenant_id: /current_user_tenant_id/i.test(def),
      checks_is_super_admin: /is_super_admin\s*\(/i.test(def),
      recommendation: existsChecksTenant
        ? "RPC independently verifies same-tenant approver — OK"
        : "GAP: RPC does not verify approver belongs to caller's tenant; relies on route-level requireTenantSuperAdmin + pre-check. Recommend adding tenant_id = current_user_tenant_id() to the user_accounts EXISTS guard (and set tenant_id on insert if not trigger-filled).",
      def_excerpt: def.slice(0, 1200),
    };

    console.log(JSON.stringify(results, null, 2));
    console.log("\nPASS: Part 1.1 + 1.2 + 1.3 functional checks succeeded");
    console.log(
      existsChecksTenant
        ? "PART 2: RPC has tenant check"
        : "PART 2: GAP — RPC relies on route check only (see recommendation)",
    );
  } finally {
    for (const target of [...cleanupTargets].reverse()) {
      try {
        await hardCleanup(admin, target);
      } catch (err) {
        console.error("Cleanup failed for", target.email, err);
      }
    }
    // Confirm cleanup
    for (const target of cleanupTargets) {
      const { data } = await admin
        .from("user_accounts")
        .select("auth_uid")
        .eq("auth_uid", target.authUid)
        .maybeSingle();
      if (data) {
        console.error("WARNING: leftover user_accounts", target.email);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
