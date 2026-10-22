/**

 * Staging RBAC matrix for finance_admin vs finance (regression).

 *

 * Safety: all employee WRITES use throwaway rows (ZZ-TEST-FA-*); service role

 * creates/removes them. Real employees are read-only probes (counts/selects).

 *

 * Local API checks require a dev server on API_BASE_URL (default http://localhost:3000)
 * running THIS repo's code against staging Supabase — not the deployed staging site.
 *
 *   npm run verify:staging-env
 *   npm run dev:staging
 *
 *   npx tsx scripts/test-finance-admin-role-staging.ts --env-file .env.staging.local
 *
 * Optional: API_BASE_URL=http://localhost:3000 (default). Does not use .env.local.
 */

// @ts-nocheck

import { readFileSync } from "node:fs";

import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import {

  mapAllowancesToLegacyColumns,

  resolveEmployeeCompensation,

} from "../app/dashboard/administration/compensation-policy-utils";

import { FINANCE_ADMIN_EMPLOYEE_BULK_IMPORT_MESSAGE } from "../lib/bulk-import/finance-admin-employee-import-messages";
import { ACTIVE_EMPLOYMENT_STATUS } from "../app/dashboard/operations/duty-roster-utils";
import { fetchDutyRosterEmployeeDisplayScoped } from "../utils/duty-roster-employees";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
  type BusinessUnitReadScope,
} from "../utils/business-unit-view";



const STAGING_REF = "wieflwbfdmjtsdnwbfii";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";



const THROWAWAY_FULL_NAME = "ROLE TEST — delete me";



type CheckRow = {

  check: string;

  expected: string;

  result: string;

  pass: boolean;

};



function loadEnvForce(filePath: string) {

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {

    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) continue;

    const i = trimmed.indexOf("=");

    if (i === -1) continue;

    let value = trimmed.slice(i + 1).trim();

    if (

      (value.startsWith('"') && value.endsWith('"')) ||

      (value.startsWith("'") && value.endsWith("'"))

    ) {

      value = value.slice(1, -1);

    }

    process.env[trimmed.slice(0, i).trim()] = value;

  }

}



function resolveEnvFile(argv: string[]) {

  const idx = argv.indexOf("--env-file");

  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];

  return ".env.staging.local";

}



function hardAssert(condition: unknown, message: string): asserts condition {

  if (!condition) throw new Error(message);

}



function supabaseProjectRef(supabaseUrl: string): string {

  return new URL(supabaseUrl).hostname.split(".")[0];

}



function buildSupabaseAuthCookie(

  supabaseUrl: string,

  session: {

    access_token: string;

    refresh_token: string;

    expires_at?: number;

    expires_in?: number;

    user: unknown;

  },

): string {

  const cookieName = `sb-${supabaseProjectRef(supabaseUrl)}-auth-token`;

  const cookieValue = encodeURIComponent(

    JSON.stringify({

      access_token: session.access_token,

      refresh_token: session.refresh_token,

      expires_at: session.expires_at,

      expires_in: session.expires_in,

      token_type: "bearer",

      user: session.user,

    }),

  );

  return `${cookieName}=${cookieValue}`;

}



async function signInClient(url: string, anonKey: string, email: string, password: string) {

  const client = createClient(url, anonKey, { auth: { persistSession: false } });

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  hardAssert(!error && data.session, error?.message ?? `sign-in failed for ${email}`);

  return client;

}



function createServiceRoleClient(url: string, serviceRoleKey: string) {

  return createClient(url, serviceRoleKey, { auth: { persistSession: false } });

}



async function loadSalaryPolicyCombo(adminClient: ReturnType<typeof createClient>, tenantId: string) {

  const { data: rateRow, error: rateError } = await adminClient

    .from("salary_rate_config")

    .select("position, employment_type, shift")

    .eq("tenant_id", tenantId)

    .order("effective_date", { ascending: false })

    .limit(1)

    .maybeSingle();

  hardAssert(!rateError && rateRow?.position, rateError?.message ?? "no salary_rate_config row");

  return rateRow;

}



async function resolveDefaultBusinessUnitId(

  adminClient: ReturnType<typeof createClient>,

  tenantId: string,

): Promise<string | null> {

  const { data, error } = await adminClient

    .from("business_units")

    .select("id")

    .eq("tenant_id", tenantId)

    .order("created_at", { ascending: true })

    .limit(1)

    .maybeSingle();

  if (error) return null;

  return data?.id ?? null;

}



/** BU the signed-in user may write under employees RLS (user_business_unit_access). */

async function resolveWritableBusinessUnitIdForAuthUid(

  adminClient: ReturnType<typeof createClient>,

  tenantId: string,

  authUid: string,

  activeBusinessUnitId: string | null,

): Promise<string | null> {

  const { data: restricted, error: restrictedError } = await adminClient

    .from("user_business_unit_access")

    .select("business_unit_id")

    .eq("tenant_id", tenantId)

    .eq("auth_uid", authUid)

    .order("created_at", { ascending: true });

  hardAssert(!restrictedError, restrictedError?.message ?? "user_business_unit_access read failed");

  const allowedIds = (restricted ?? [])

    .map((row) => row.business_unit_id as string | null)

    .filter(Boolean) as string[];

  if (allowedIds.length === 0) {

    return resolveDefaultBusinessUnitId(adminClient, tenantId);

  }

  if (activeBusinessUnitId && allowedIds.includes(activeBusinessUnitId)) {

    return activeBusinessUnitId;

  }

  return allowedIds[0] ?? null;

}



async function resolveExpectedPayFromSalarySettings(

  adminClient: ReturnType<typeof createClient>,

  tenantId: string,

  businessUnitId: string | null,

  position: string,

  employmentType: string,

  shift: string,

) {

  const [ratesResult, policiesResult, typesResult, welfareResult] = await Promise.all([

    adminClient.from("salary_rate_config").select("*").eq("tenant_id", tenantId),

    adminClient.from("compensation_policy").select("*").eq("tenant_id", tenantId),

    adminClient

      .from("allowance_types")

      .select("id, tenant_id, code, name, is_active, sort_order")

      .eq("tenant_id", tenantId),

    adminClient

      .from("hr_payroll_settings")

      .select("default_welfare_deduction_rate, business_unit_id")

      .eq("tenant_id", tenantId),

  ]);



  hardAssert(!ratesResult.error, ratesResult.error?.message ?? "salary_rate_config load failed");

  hardAssert(!policiesResult.error, policiesResult.error?.message ?? "compensation_policy load failed");

  hardAssert(!typesResult.error, typesResult.error?.message ?? "allowance_types load failed");

  hardAssert(!welfareResult.error, welfareResult.error?.message ?? "hr_payroll_settings load failed");



  const resolved = resolveEmployeeCompensation(

    (ratesResult.data ?? []).map((row) => ({

      id: String(row.id),

      position: String(row.position),

      employment_type: String(row.employment_type),

      shift: String(row.shift),

      basic_salary: Number(row.basic_salary) || 0,

      effective_date: String(row.effective_date ?? "").slice(0, 10),

    })),

    (policiesResult.data ?? []).map((row) => ({

      id: String(row.id),

      position: String(row.position),

      employment_type: String(row.employment_type),

      shift: String(row.shift),

      allowance_type_id: String(row.allowance_type_id),

      amount: Number(row.amount) || 0,

    })),

    (typesResult.data ?? []).map((row) => ({

      id: String(row.id),

      code: String(row.code),

      name: String(row.name),

      is_active: row.is_active !== false,

      sort_order: Number(row.sort_order) || 0,

    })),

    position,

    employmentType,

    shift,

  );

  const legacy = mapAllowancesToLegacyColumns(resolved.allowances);

  const welfareRows = welfareResult.data ?? [];

  const buKey = businessUnitId ?? null;

  const welfareRow =

    welfareRows.find((row) => row.business_unit_id === buKey) ??

    welfareRows.find((row) => row.business_unit_id === null);

  const welfareRate =

    welfareRow?.default_welfare_deduction_rate === null ||

    welfareRow?.default_welfare_deduction_rate === undefined

      ? null

      : Number(welfareRow.default_welfare_deduction_rate);



  return {

    basic_salary: resolved.basic_salary,

    housing_allowance: legacy.housing_allowance,

    transport_allowance: legacy.transport_allowance,

    other_allowances: legacy.other_allowances,

    welfare_deduction_rate: welfareRate,

  };

}



type ThrowawaySpec = {

  employee_id: string;

  staff_id: string;

  tenant_id: string;

  business_unit_id: string | null;

  position: string;

  employment_type: string;

  shift: string;

  basic_salary: number;

  housing_allowance: number;

  transport_allowance: number;

  other_allowances: number;

  welfare_deduction_rate: number | null;

  phone: string | null;

  bank_name: string | null;

};



async function insertThrowawayEmployee(

  adminClient: ReturnType<typeof createClient>,

  spec: ThrowawaySpec,

) {

  const { error } = await adminClient.from("employees").insert({

    tenant_id: spec.tenant_id,

    employee_id: spec.employee_id,

    staff_id: spec.staff_id,

    full_name: THROWAWAY_FULL_NAME,

    employment_type: spec.employment_type,

    employment_status: "Active",

    position: spec.position,

    shift: spec.shift,

    business_unit_id: spec.business_unit_id,

    basic_salary: spec.basic_salary,

    housing_allowance: spec.housing_allowance,

    transport_allowance: spec.transport_allowance,

    other_allowances: spec.other_allowances,

    welfare_deduction_rate: spec.welfare_deduction_rate,

    phone: spec.phone,

    bank_name: spec.bank_name,

    payment_method: null,

    account_number: null,

    momo_number: null,

    momo_name: null,

  });

  hardAssert(!error, `service-role throwaway insert failed: ${error?.message}`);

}



async function buildThrowawaySpec(

  adminClient: ReturnType<typeof createClient>,

  runId: number,

  suffix: string,

  payOverride?: Partial<{

    basic_salary: number;

    housing_allowance: number;

    transport_allowance: number;

    other_allowances: number;

    welfare_deduction_rate: number | null;

  }>,

  businessUnitIdOverride?: string | null,

): Promise<ThrowawaySpec> {

  const combo = await loadSalaryPolicyCombo(adminClient, DAVORS_TENANT_ID);

  const businessUnitId =

    businessUnitIdOverride !== undefined

      ? businessUnitIdOverride

      : await resolveDefaultBusinessUnitId(adminClient, DAVORS_TENANT_ID);

  const expectedPay = await resolveExpectedPayFromSalarySettings(

    adminClient,

    DAVORS_TENANT_ID,

    businessUnitId,

    combo.position,

    combo.employment_type,

    combo.shift,

  );

  return {

    employee_id: `ZZ-TEST-FA-${runId}-${suffix}`,

    staff_id: `ZZ-TEST-STAFF-${runId}-${suffix}`,

    tenant_id: DAVORS_TENANT_ID,

    business_unit_id: businessUnitId,

    position: combo.position,

    employment_type: combo.employment_type,

    shift: combo.shift,

    basic_salary: payOverride?.basic_salary ?? expectedPay.basic_salary,

    housing_allowance: payOverride?.housing_allowance ?? expectedPay.housing_allowance,

    transport_allowance: payOverride?.transport_allowance ?? expectedPay.transport_allowance,

    other_allowances: payOverride?.other_allowances ?? expectedPay.other_allowances,

    welfare_deduction_rate:

      payOverride?.welfare_deduction_rate ?? expectedPay.welfare_deduction_rate,

    phone: null,

    bank_name: null,

  };

}



async function employeeDeleteBlocked(client: ReturnType<typeof createClient>, employeeId: string) {

  const { data, error } = await client

    .from("employees")

    .delete()

    .eq("employee_id", employeeId)

    .select("employee_id");

  hardAssert(!error, error?.message ?? "delete request failed");

  hardAssert((data ?? []).length === 0, "0 rows deleted");

  const { data: still, error: stillError } = await client

    .from("employees")

    .select("employee_id")

    .eq("employee_id", employeeId)

    .maybeSingle();

  hardAssert(!stillError, stillError?.message ?? "still-exists select failed");

  hardAssert(still?.employee_id === employeeId, "row still exists");

  return "blocked (0 rows, row exists)";

}



async function employeeDeleteAllowed(client: ReturnType<typeof createClient>, employeeId: string) {

  const { data, error } = await client

    .from("employees")

    .delete()

    .eq("employee_id", employeeId)

    .select("employee_id");

  hardAssert(!error, error?.message ?? "delete failed");

  const deletedCount = (data ?? []).length;

  hardAssert(deletedCount === 1, `expected 1 row deleted, got ${deletedCount}`);

  return "1 row deleted";

}



const API_FETCH_TIMEOUT_MS = 60_000;



async function fetchApiWithRetry(

  url: string,

  init: RequestInit,

  label: string,

): Promise<Response> {

  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {

    const controller = new AbortController();

    const timer = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);

    try {

      const response = await fetch(url, { ...init, signal: controller.signal });

      clearTimeout(timer);

      return response;

    } catch (err) {

      clearTimeout(timer);

      lastError = err;

      if (attempt < 2) {

        await new Promise((resolve) => setTimeout(resolve, 500));

      }

    }

  }

  const cause =

    lastError instanceof Error

      ? `${lastError.name}: ${lastError.message}`

      : String(lastError);

  throw new Error(`${label} fetch failed after 2 attempts (${cause})`);

}



function isRlsViolationMessage(message: string | undefined): boolean {

  return (message ?? "").toLowerCase().includes("violates row-level security");

}



async function insertBlockedByRls(

  client: ReturnType<typeof createClient>,

  table: "sites" | "work_orders",

  row: Record<string, unknown>,

  returningColumn: string,

) {

  const { data, error } = await client.from(table).insert(row).select(returningColumn);

  if (error && isRlsViolationMessage(error.message)) {

    return "RLS error (insert blocked)";

  }

  hardAssert(!error, error?.message ?? "insert API error");

  hardAssert((data ?? []).length === 0, "expected 0 rows inserted");

  return "0 rows inserted (RLS)";

}



type DutyRosterParityMetrics = {

  projectCount: number;

  activeRosterEmployees: number;

  centralUniversityLatestRotation: number;

};



async function resolveCentralUniversityClientId(

  client: ReturnType<typeof createClient>,

): Promise<string | null> {

  const { data, error } = await client

    .from("customers")

    .select("client_id, client_name")

    .eq("tenant_id", DAVORS_TENANT_ID)

    .ilike("client_name", "%Central University%")

    .order("client_name", { ascending: true })

    .limit(1)

    .maybeSingle();

  hardAssert(!error, error?.message ?? "Central University client lookup failed");

  return data?.client_id ?? null;

}



async function collectDutyRosterParityMetrics(

  client: ReturnType<typeof createClient>,

  buScope: BusinessUnitReadScope,

  centralUniversityClientId: string | null,

): Promise<DutyRosterParityMetrics> {

  const { count: projectCount, error: projectsError } = await applyBusinessUnitScope(

    client

      .from("projects")

      .select("id", { count: "exact", head: true })

      .eq("tenant_id", DAVORS_TENANT_ID)

      .eq("is_archived", false),

    buScope,

  );

  hardAssert(!projectsError, projectsError?.message ?? "projects count failed");

  const employeesResult = await fetchDutyRosterEmployeeDisplayScoped(client, buScope);

  hardAssert(!employeesResult.error, employeesResult.error ?? "roster employees RPC failed");

  const activeRosterEmployees = employeesResult.employees.filter(

    (employee) => employee.employment_status === ACTIVE_EMPLOYMENT_STATUS,

  ).length;

  let centralUniversityLatestRotation = 0;

  if (centralUniversityClientId) {

    const { data: metadataRows, error: metadataError } = await applyBusinessUnitScope(

      client

        .from("roster_rotation_metadata")

        .select("rotation_number, client_id")

        .eq("tenant_id", DAVORS_TENANT_ID),

      buScope,

    );

    hardAssert(!metadataError, metadataError?.message ?? "rotation metadata read failed");

    for (const row of metadataRows ?? []) {

      if (row.client_id !== centralUniversityClientId) continue;

      centralUniversityLatestRotation = Math.max(

        centralUniversityLatestRotation,

        Number(row.rotation_number) || 0,

      );

    }

  }

  return {

    projectCount: projectCount ?? 0,

    activeRosterEmployees,

    centralUniversityLatestRotation,

  };

}



function printSummaryTable(rows: CheckRow[]) {

  const colCheck = Math.max(5, ...rows.map((r) => r.check.length));

  const colExpected = Math.max(8, ...rows.map((r) => r.expected.length));

  const colResult = Math.max(6, ...rows.map((r) => r.result.length));

  console.log("\n=== Summary ===");

  console.log(

    `${"check".padEnd(colCheck)} | ${"expected".padEnd(colExpected)} | ${"result".padEnd(colResult)} | PASS/FAIL`,

  );

  console.log(`${"-".repeat(colCheck)}-+-${"-".repeat(colExpected)}-+-${"-".repeat(colResult)}-+---------`);

  for (const row of rows) {

    console.log(

      `${row.check.padEnd(colCheck)} | ${row.expected.padEnd(colExpected)} | ${row.result.padEnd(colResult)} | ${row.pass ? "PASS" : "FAIL"}`,

    );

  }

}



async function main() {

  const checks: CheckRow[] = [];

  const throwawayEmployeeIds: string[] = [];

  let runId = Date.now();

  let primaryThrowawayId: string | null = null;



  async function runCheck(check: string, expected: string, fn: () => Promise<string>) {
    try {
      const result = await fn();
      checks.push({ check, expected, result, pass: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({ check, expected, result: message.slice(0, 160), pass: false });
    }
  }



  const envFile = resolveEnvFile(process.argv.slice(2));

  loadEnvForce(resolve(envFile));



  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  const apiBase = (process.env.API_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");



  let supabaseProjectRefValue = "";

  try {

    supabaseProjectRefValue = supabaseProjectRef(url);

  } catch {

    supabaseProjectRefValue = "";

  }



  console.log(`Supabase project ref: ${supabaseProjectRefValue || "(invalid URL)"}`);

  console.log(`API base URL: ${apiBase}`);



  hardAssert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");

  hardAssert(

    supabaseProjectRefValue !== PRODUCTION_REF && !url.includes(PRODUCTION_REF),

    `Refusing production Supabase project ref ${PRODUCTION_REF}`,

  );

  hardAssert(url.includes(STAGING_REF), `Refusing non-staging URL (expected ref ${STAGING_REF}): ${url}`);

  hardAssert(anonKey, "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");

  hardAssert(serviceRoleKey.trim(), "SUPABASE_SERVICE_ROLE_KEY required for throwaway create/cleanup");



  const adminClient = createServiceRoleClient(url, serviceRoleKey);



  let faClient: ReturnType<typeof createClient> | null = null;

  try {

    runId = Date.now();

    const sharedSpec = await buildThrowawaySpec(adminClient, runId, "shared");

    primaryThrowawayId = sharedSpec.employee_id;

    throwawayEmployeeIds.push(sharedSpec.employee_id);

    await insertThrowawayEmployee(adminClient, sharedSpec);



    console.log(`\nThrowaway employee (shared writes): ${primaryThrowawayId}`);

    console.log(`Staff id: ${sharedSpec.staff_id}`);

    console.log(`Tenant: ${DAVORS_TENANT_ID}`);



    const faEmail = process.env.FINANCE_ADMIN_TEST_EMAIL ?? "";

    const faPassword = process.env.FINANCE_ADMIN_TEST_PASSWORD ?? "";

    hardAssert(faEmail && faPassword, "Set FINANCE_ADMIN_TEST_EMAIL and FINANCE_ADMIN_TEST_PASSWORD");



    faClient = await signInClient(url, anonKey, faEmail, faPassword);

    const faSession = (await faClient.auth.getSession()).data.session;

    hardAssert(faSession, "finance_admin session missing after sign-in");

    const faAuthCookie = buildSupabaseAuthCookie(url, faSession);

    const { data: faAccount } = await faClient

      .from("user_accounts")

      .select("role, tenant_id, view_all_business_units, active_business_unit_id")

      .maybeSingle();



    await runCheck("finance_admin session role", "finance_admin", async () => {

      hardAssert(faAccount?.role === "finance_admin", `got ${faAccount?.role}`);

      return "finance_admin";

    });



    const sharedId = sharedSpec.employee_id;

    const baselineSalary = sharedSpec.basic_salary;

    const testPhone = `+2331999${String(runId).slice(-7)}`;



    await runCheck("finance_admin pay update (basic_salary)", "trigger error", async () => {

      const { error } = await faClient

        .from("employees")

        .update({ basic_salary: baselineSalary + 1 })

        .eq("employee_id", sharedId);

      hardAssert(error, "expected trigger/RLS error");

      return "trigger error";

    });



    await runCheck("finance_admin bank_name update", "trigger error", async () => {

      const { error } = await faClient

        .from("employees")

        .update({ bank_name: "RBAC Test Bank" })

        .eq("employee_id", sharedId);

      hardAssert(error, "expected trigger error");

      return "trigger error";

    });



    await runCheck("finance_admin momo_number update", "trigger error", async () => {

      const { error } = await faClient

        .from("employees")

        .update({ momo_number: "+233200000099" })

        .eq("employee_id", sharedId);

      hardAssert(error, "expected trigger error");

      return "trigger error";

    });



    await runCheck("finance_admin non-pay phone update", "1 row updated", async () => {

      const { data, error } = await faClient

        .from("employees")

        .update({ phone: testPhone })

        .eq("employee_id", sharedId)

        .select("employee_id");

      hardAssert(!error, error?.message);

      hardAssert((data ?? []).length === 1, "expected 1 row");

      return "1 row updated";

    });



    await runCheck("finance_admin employee delete", "blocked (0 rows, row exists)", async () =>

      employeeDeleteBlocked(faClient, sharedId),

    );



    await runCheck("finance_admin employees read (count>0)", ">0 rows", async () => {

      const { count, error } = await faClient

        .from("employees")

        .select("employee_id", { count: "exact", head: true });

      hardAssert(!error, error?.message);

      hardAssert((count ?? 0) > 0, "no employees visible");

      return `>${count} rows`;

    });



    await runCheck("real employee read (not throwaway)", "visible", async () => {

      const { data, error } = await faClient

        .from("employees")

        .select("employee_id, full_name")

        .eq("tenant_id", DAVORS_TENANT_ID)

        .neq("employee_id", sharedId)

        .order("employee_id", { ascending: true })

        .limit(1)

        .maybeSingle();

      hardAssert(!error && data?.employee_id, "no real employee readable");

      return "visible";

    });



    await runCheck("finance_admin site insert", "blocked (RLS error or 0 rows)", async () =>

      insertBlockedByRls(

        faClient,

        "sites",

        {

          site_code: `RBAC-${runId}`,

          site_name: "RBAC probe",

          client_id: null,

          tenant_id: DAVORS_TENANT_ID,

        },

        "site_code",

      ),

    );



    await runCheck("finance_admin work_orders insert", "blocked (RLS error or 0 rows)", async () =>

      insertBlockedByRls(

        faClient,

        "work_orders",

        {

          work_order_no: `WO-RBAC-${runId}`,

          tenant_id: DAVORS_TENANT_ID,

          site_id: "PROBE",

          date: new Date().toISOString().slice(0, 10),

        },

        "work_order_no",

      ),

    );



    await runCheck("finance_admin payroll lock API", "403", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/hr-payroll/lock-period`,

        {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Cookie: faAuthCookie,

          },

          body: JSON.stringify({ year: 2026, month: 1 }),

        },

        "payroll lock",

      );

      hardAssert(res.status === 403, `got ${res.status}`);

      return "403";

    });



    await runCheck("finance_admin dividends API", "403", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/finance/dividend-declarations`,

        { headers: { Cookie: faAuthCookie } },

        "dividends",

      );

      hardAssert(res.status === 403, `got ${res.status}`);

      return "403";

    });



    await runCheck("finance_admin caanta tenant isolation", "0 employees", async () => {

      const { count, error } = await faClient

        .from("employees")

        .select("employee_id", { count: "exact", head: true })

        .eq("tenant_id", CAANTA_TENANT_ID);

      hardAssert(!error, error?.message);

      hardAssert((count ?? 0) === 0, `got ${count}`);

      return "0 employees";

    });



    await runCheck("finance_admin stock adjustment API", "403", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/inventory/raw-material-adjustments`,

        {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Cookie: faAuthCookie,

          },

          body: JSON.stringify({}),

        },

        "stock adjustment",

      );

      hardAssert(res.status === 403, `got ${res.status}`);

      return "403";

    });



    await runCheck("finance_admin finished product stock adjustment API", "403", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/inventory/finished-product-adjustments`,

        {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Cookie: faAuthCookie,

          },

          body: JSON.stringify({}),

        },

        "finished product adjustment",

      );

      hardAssert(res.status === 403, `got ${res.status}`);

      return "403";

    });



    await runCheck("finance_admin inventory go-live API", "403", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/inventory-balance-config`,

        {

          method: "PUT",

          headers: {

            "Content-Type": "application/json",

            Cookie: faAuthCookie,

          },

          body: JSON.stringify({ go_live_date: "2026-01-01", opening_inventory_value: 0 }),

        },

        "inventory go-live",

      );

      hardAssert(res.status === 403, `got ${res.status}`);

      return "403";

    });



    await runCheck("finance_admin product bulk import", "200", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/bulk-import/upload`,

        {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Cookie: faAuthCookie,

          },

          body: JSON.stringify({

            action: "init",

            import_type: "product",

            file_name: "rbac-products-probe.xlsx",

            file_hash: `rbac-products-probe-${runId}`,

            headers: ["product_name"],

            total_rows: 0,

          }),

        },

        "product bulk import",

      );

      hardAssert(res.status === 200, `got ${res.status}`);

      return "200";

    });



    await runCheck("finance_admin production batch edit-eligibility", "200", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/inventory/production-batches/edit-eligibility`,

        { headers: { Cookie: faAuthCookie } },

        "production batch edit-eligibility",

      );

      hardAssert(res.status === 200, `got ${res.status}`);

      return "200";

    });



    await runCheck("finance_admin PO create API", "200 or 400", async () => {

      const { data: supplierRow } = await faClient

        .from("suppliers")

        .select("id")

        .eq("tenant_id", DAVORS_TENANT_ID)

        .limit(1)

        .maybeSingle();

      hardAssert(supplierRow?.id, "no supplier");

      const res = await fetchApiWithRetry(

        `${apiBase}/api/purchase-orders`,

        {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Cookie: faAuthCookie,

          },

          body: JSON.stringify({

            supplier_id: supplierRow.id,

            status: "draft",

            line_items: [],

          }),

        },

        "PO create",

      );

      hardAssert(res.status === 200 || res.status === 400, `got ${res.status}`);

      return "200 or 400";

    });



    const combo = await loadSalaryPolicyCombo(adminClient, DAVORS_TENANT_ID);

    const buId = sharedSpec.business_unit_id;

    const expectedPay = await resolveExpectedPayFromSalarySettings(

      adminClient,

      DAVORS_TENANT_ID,

      buId,

      combo.position,

      combo.employment_type,

      combo.shift,

    );



    const insertOkId = `ZZ-TEST-FA-${runId}-ins-ok`;

    throwawayEmployeeIds.push(insertOkId);

    await runCheck("finance_admin insert (policy pay)", "insert OK", async () => {

      const { error } = await faClient.from("employees").insert({

        tenant_id: DAVORS_TENANT_ID,

        employee_id: insertOkId,

        staff_id: `ZZ-TEST-STAFF-${runId}-ins-ok`,

        full_name: THROWAWAY_FULL_NAME,

        employment_type: combo.employment_type,

        employment_status: "Active",

        position: combo.position,

        shift: combo.shift,

        business_unit_id: buId,

        basic_salary: expectedPay.basic_salary,

        housing_allowance: expectedPay.housing_allowance,

        transport_allowance: expectedPay.transport_allowance,

        other_allowances: expectedPay.other_allowances,

        welfare_deduction_rate: expectedPay.welfare_deduction_rate,

        payment_method: null,

        bank_name: null,

        account_number: null,

        momo_number: null,

        momo_name: null,

      });

      hardAssert(!error, error?.message);

      return "insert OK";

    });



    const insertBadSalaryId = `ZZ-TEST-FA-${runId}-ins-bad-pay`;

    await runCheck("finance_admin insert (wrong basic_salary)", "trigger error", async () => {

      const { error } = await faClient.from("employees").insert({

        tenant_id: DAVORS_TENANT_ID,

        employee_id: insertBadSalaryId,

        staff_id: `ZZ-TEST-STAFF-${runId}-ins-bad-pay`,

        full_name: THROWAWAY_FULL_NAME,

        employment_type: combo.employment_type,

        employment_status: "Active",

        position: combo.position,

        shift: combo.shift,

        business_unit_id: buId,

        basic_salary: expectedPay.basic_salary + 1,

        housing_allowance: expectedPay.housing_allowance,

        transport_allowance: expectedPay.transport_allowance,

        other_allowances: expectedPay.other_allowances,

        welfare_deduction_rate: expectedPay.welfare_deduction_rate,

      });

      hardAssert(error, "expected failure");

      return "trigger error";

    });



    const insertMomoId = `ZZ-TEST-FA-${runId}-ins-momo`;

    await runCheck("finance_admin insert (momo_number)", "trigger error", async () => {

      const { error } = await faClient.from("employees").insert({

        tenant_id: DAVORS_TENANT_ID,

        employee_id: insertMomoId,

        staff_id: `ZZ-TEST-STAFF-${runId}-ins-momo`,

        full_name: THROWAWAY_FULL_NAME,

        employment_type: combo.employment_type,

        employment_status: "Active",

        position: combo.position,

        shift: combo.shift,

        business_unit_id: buId,

        basic_salary: expectedPay.basic_salary,

        housing_allowance: expectedPay.housing_allowance,

        transport_allowance: expectedPay.transport_allowance,

        other_allowances: expectedPay.other_allowances,

        welfare_deduction_rate: expectedPay.welfare_deduction_rate,

        momo_number: "+233200000099",

      });

      hardAssert(error, "expected failure");

      return "trigger error";

    });



    await runCheck("finance_admin employee bulk import", "403", async () => {

      const res = await fetchApiWithRetry(

        `${apiBase}/api/bulk-import/upload`,

        {

          method: "POST",

          headers: {

            "Content-Type": "application/json",

            Cookie: faAuthCookie,

          },

          body: JSON.stringify({

            action: "init",

            import_type: "employee",

            file_name: "rbac-probe.xlsx",

            file_hash: `rbac-probe-${runId}`,

            headers: ["full_name"],

            total_rows: 0,

          }),

        },

        "bulk import",

      );

      hardAssert(res.status === 403, `got ${res.status}`);

      const payload = (await res.json()) as { error?: string };

      hardAssert(

        payload.error === FINANCE_ADMIN_EMPLOYEE_BULK_IMPORT_MESSAGE,

        payload.error ?? "missing error body",

      );

      return "403";

    });



    const finEmail = process.env.FINANCE_REGRESSION_TEST_EMAIL ?? "";

    const finPassword = process.env.FINANCE_REGRESSION_TEST_PASSWORD ?? "";

    if (finEmail && finPassword) {

      const finClient = await signInClient(url, anonKey, finEmail, finPassword);

      const { data: finAccount } = await finClient

        .from("user_accounts")

        .select("auth_uid, tenant_id, active_business_unit_id")

        .maybeSingle();

      hardAssert(finAccount?.auth_uid, "finance regression user missing auth_uid");

      const financeWritableBuId = await resolveWritableBusinessUnitIdForAuthUid(

        adminClient,

        finAccount.tenant_id ?? DAVORS_TENANT_ID,

        finAccount.auth_uid,

        finAccount.active_business_unit_id ?? null,

      );

      hardAssert(financeWritableBuId, "no business unit finance user may write");

      const financeSpec = await buildThrowawaySpec(

        adminClient,

        runId,

        "finance-writes",

        undefined,

        financeWritableBuId,

      );

      throwawayEmployeeIds.push(financeSpec.employee_id);

      await insertThrowawayEmployee(adminClient, financeSpec);

      const financeId = financeSpec.employee_id;



      await runCheck("finance pay update (basic_salary)", "1 row updated", async () => {

        const { data, error } = await finClient

          .from("employees")

          .update({ basic_salary: financeSpec.basic_salary + 50 })

          .eq("employee_id", financeId)

          .select("employee_id");

        hardAssert(!error, error?.message);

        hardAssert((data ?? []).length === 1, "expected 1 row");

        return "1 row updated";

      });



      await runCheck("finance bank_name update", "1 row updated", async () => {

        const { data, error } = await finClient

          .from("employees")

          .update({ bank_name: "RBAC Finance Bank" })

          .eq("employee_id", financeId)

          .select("employee_id");

        hardAssert(!error, error?.message);

        hardAssert((data ?? []).length === 1, "expected 1 row");

        return "1 row updated";

      });



      await runCheck("finance employee delete", "1 row deleted", async () => {

        const result = await employeeDeleteAllowed(finClient, financeId);

        const idx = throwawayEmployeeIds.indexOf(financeId);

        if (idx >= 0) throwawayEmployeeIds.splice(idx, 1);

        return result;

      });



      const financeInsertId = `ZZ-TEST-FA-${runId}-fin-ins`;

      throwawayEmployeeIds.push(financeInsertId);

      const financeInsertExpectedPay = await resolveExpectedPayFromSalarySettings(

        adminClient,

        DAVORS_TENANT_ID,

        financeWritableBuId,

        combo.position,

        combo.employment_type,

        combo.shift,

      );

      await runCheck("finance insert (custom salary)", "insert OK", async () => {

        const { error } = await finClient.from("employees").insert({

          tenant_id: DAVORS_TENANT_ID,

          employee_id: financeInsertId,

          staff_id: `ZZ-TEST-STAFF-${runId}-fin-ins`,

          full_name: THROWAWAY_FULL_NAME,

          employment_type: combo.employment_type,

          employment_status: "Active",

          position: combo.position,

          shift: combo.shift,

          business_unit_id: financeWritableBuId,

          basic_salary: financeInsertExpectedPay.basic_salary + 50,

          housing_allowance: financeInsertExpectedPay.housing_allowance,

          transport_allowance: financeInsertExpectedPay.transport_allowance,

          other_allowances: financeInsertExpectedPay.other_allowances,

          welfare_deduction_rate: financeInsertExpectedPay.welfare_deduction_rate,

        });

        hardAssert(!error, error?.message);

        return "insert OK";

      });

    } else {

      await runCheck("finance regression", "skipped (env)", async () => "skipped (env)");

    }



    hardAssert(faClient, "finance_admin client missing");

    const dutyRosterBuScope = resolveBusinessUnitReadScope({

      viewAllBusinessUnits: Boolean(faAccount?.view_all_business_units),

      activeBusinessUnitId: faAccount?.active_business_unit_id ?? null,

    });

    const centralUniversityClientId = await resolveCentralUniversityClientId(adminClient);

    hardAssert(

      centralUniversityClientId,

      "Central University client not found for Davors tenant",

    );

    const faRosterMetrics = await collectDutyRosterParityMetrics(

      faClient,

      dutyRosterBuScope,

      centralUniversityClientId,

    );

    const superEmail = process.env.SUPER_ADMIN_TEST_EMAIL ?? "";

    const superPassword = process.env.SUPER_ADMIN_TEST_PASSWORD ?? "";

    if (superEmail && superPassword) {

      const superClient = await signInClient(url, anonKey, superEmail, superPassword);

      const superRosterMetrics = await collectDutyRosterParityMetrics(

        superClient,

        dutyRosterBuScope,

        centralUniversityClientId,

      );

      await runCheck("duty roster projects parity (finance_admin vs super_admin)", "equal counts", async () => {

        hardAssert(

          faRosterMetrics.projectCount === superRosterMetrics.projectCount,

          `finance_admin ${faRosterMetrics.projectCount} vs super_admin ${superRosterMetrics.projectCount}`,

        );

        return `${faRosterMetrics.projectCount}`;

      });

      await runCheck(

        "duty roster active employees parity (finance_admin vs super_admin)",

        "equal counts",

        async () => {

          hardAssert(

            faRosterMetrics.activeRosterEmployees === superRosterMetrics.activeRosterEmployees,

            `finance_admin ${faRosterMetrics.activeRosterEmployees} vs super_admin ${superRosterMetrics.activeRosterEmployees}`,

          );

          return `${faRosterMetrics.activeRosterEmployees}`;

        },

      );

      await runCheck(

        "Central University latest rotation parity (finance_admin vs super_admin)",

        "equal rotation",

        async () => {

          hardAssert(

            faRosterMetrics.centralUniversityLatestRotation ===

              superRosterMetrics.centralUniversityLatestRotation,

            `finance_admin ${faRosterMetrics.centralUniversityLatestRotation} vs super_admin ${superRosterMetrics.centralUniversityLatestRotation}`,

          );

          return `${faRosterMetrics.centralUniversityLatestRotation}`;

        },

      );

    } else {

      await runCheck(

        "duty roster parity baseline",

        "SUPER_ADMIN_TEST_* in .env.staging.local",

        async () => {

          throw new Error(

            "Add SUPER_ADMIN_TEST_EMAIL and SUPER_ADMIN_TEST_PASSWORD to .env.staging.local (service role RPC baseline is invalid)",

          );

        },

      );

    }

    await runCheck("finance_admin projects read", ">0 rows", async () => {
      const { count, error } = await faClient!

        .from("projects")

        .select("id", { count: "exact", head: true });

      hardAssert(!error, error?.message);

      hardAssert((count ?? 0) > 0, "empty");

      return `>${count} rows`;

    });



    await runCheck("finance_admin sites read", ">0 rows", async () => {
      const { count, error } = await faClient!

        .from("sites")

        .select("site_code", { count: "exact", head: true });

      hardAssert(!error, error?.message);

      hardAssert((count ?? 0) > 0, "empty");

      return `>${count} rows`;

    });



    await runCheck("finance_admin roster_rotation_metadata read", ">0 rows", async () => {
      const { count, error } = await faClient!

        .from("roster_rotation_metadata")

        .select("id", { count: "exact", head: true });

      hardAssert(!error, error?.message);

      hardAssert((count ?? 0) > 0, "empty");

      return `>${count} rows`;

    });
  } catch (setupError) {
    const message = setupError instanceof Error ? setupError.message : String(setupError);
    checks.push({
      check: "setup",
      expected: "complete",
      result: message.slice(0, 160),
      pass: false,
    });
  } finally {
    const uniqueIds = [...new Set(throwawayEmployeeIds)];
    for (const employeeId of uniqueIds) {
      await adminClient.from("employees").delete().eq("employee_id", employeeId);
    }

    let remaining = 0;

    for (const employeeId of uniqueIds) {

      const { data } = await adminClient

        .from("employees")

        .select("employee_id")

        .eq("employee_id", employeeId)

        .maybeSingle();

      if (data?.employee_id) remaining += 1;

    }



    console.log(`\nCleanup: removed ${uniqueIds.length} throwaway id(s); ${remaining} still present.`);

    if (primaryThrowawayId) {

      const { data: primaryStill } = await adminClient

        .from("employees")

        .select("employee_id")

        .eq("employee_id", primaryThrowawayId)

        .maybeSingle();

      console.log(

        `Primary throwaway ${primaryThrowawayId}: ${primaryStill ? "STILL EXISTS (unexpected)" : "confirmed removed"}`,

      );

    }



    await runCheck("throwaway cleanup", "0 remaining", async () => {

      hardAssert(remaining === 0, `${remaining} throwaway row(s) remain`);

      return "0 remaining";

    });

  }



  printSummaryTable(checks);



  const failed = checks.filter((c) => !c.pass).length;

  if (failed > 0) {

    console.log(`\n${failed} check(s) failed.`);

    process.exit(1);

  }

  console.log("\nAll checks passed.");

}



main().catch((err) => {

  console.error(err);

  process.exit(1);

});


