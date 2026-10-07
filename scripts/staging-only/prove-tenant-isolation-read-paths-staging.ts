/**
 * Prove tenant isolation on list/refetch paths (real user sessions, anon client).
 * npx tsx scripts/staging-only/prove-tenant-isolation-read-paths-staging.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchLoansAndAdvancesForRegister } from "../../app/dashboard/hr-payroll/loans-advances-register-fetch";
import { fetchLeaveBalancesPageData } from "../../app/dashboard/hr-payroll/leave-balances-page-fetch";
import { fetchLeavePageData } from "../../app/dashboard/hr-payroll/leave-page-fetch";
import { resolveBusinessUnitReadScope } from "../../utils/business-unit-view";
import { fetchScopedInternalConsumptionEntries } from "../../lib/inventory/fetch-scoped-internal-consumption";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

type Row = { pass: boolean; path: string; user: string; detail: string };

const results: Row[] = [];

function record(path: string, user: string, pass: boolean, detail: string) {
  results.push({ path, user, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} [${user}] ${path} — ${detail}`);
}

async function createTenantUser(
  admin: SupabaseClient,
  tenantId: string,
  label: string,
) {
  const stamp = Date.now();
  const email = `iso.${label}.${stamp}@test.davors`;
  const password = `Iso-${stamp}!Aa9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser");

  const { data: bu } = await admin
    .from("business_units")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: tenantId,
    role: "super_admin",
    is_active: true,
    active_business_unit_id: bu?.id ?? null,
  });

  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error: signErr } = await client.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr) throw signErr;
  return { client, tenantId, buId: bu?.id ?? null, label };
}

function foreignTenantRows(
  rows: Array<{ tenant_id?: string | null; advance_id?: string; employee_id?: string }>,
  ownTenantId: string,
  foreignPrefix: string,
) {
  const crossTenant = rows.filter((r) => r.tenant_id && r.tenant_id !== ownTenantId);
  const foreignIds = rows.filter(
    (r) =>
      (r.advance_id?.startsWith(foreignPrefix) ?? false) ||
      (r.employee_id?.startsWith(foreignPrefix) ?? false),
  );
  return { crossTenant: crossTenant.length, foreignIds: foreignIds.length };
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const davors = await createTenantUser(admin, DAVORS, "davors");
  const caanta = await createTenantUser(admin, CAANTA, "caanta");

  for (const session of [davors, caanta]) {
    const foreignPrefix = session.tenantId === DAVORS ? "CAN-" : "DF-";
    const foreignTenantId = session.tenantId === DAVORS ? CAANTA : DAVORS;
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits: false,
      activeBusinessUnitId: session.buId,
    });

    const loansAdv = await fetchLoansAndAdvancesForRegister(
      session.client,
      session.tenantId,
      buScope,
    );
    const laCheck = foreignTenantRows(
      loansAdv.advances as Array<{ tenant_id?: string; advance_id?: string; employee_id?: string }>,
      session.tenantId,
      foreignPrefix,
    );
    record(
      "fetchLoansAndAdvancesForRegister (post-mutation refetch)",
      session.label,
      laCheck.crossTenant === 0 && laCheck.foreignIds === 0 && !loansAdv.error,
      loansAdv.error ??
        `advances=${loansAdv.advances.length} crossTenant=${laCheck.crossTenant} foreignIds=${laCheck.foreignIds}`,
    );

    const ic = await fetchScopedInternalConsumptionEntries(
      session.client,
      session.tenantId,
      buScope,
    );
    record(
      "fetchScopedInternalConsumptionEntries",
      session.label,
      !ic.error,
      ic.error ?? `entries=${ic.entries.length}`,
    );

    const { data: payRows, error: payErr } = await session.client
      .from("payment_accounts")
      .select("tenant_id")
      .eq("is_active", true);
    const payCross = (payRows ?? []).filter(
      (r) => r.tenant_id && r.tenant_id !== session.tenantId,
    ).length;
    record(
      "payment_accounts list (session client)",
      session.label,
      !payErr && payCross === 0,
      payErr?.message ?? `accounts=${(payRows ?? []).length} crossTenant=${payCross}`,
    );

    const { data: rawAdv } = await session.client
      .from("salary_advance_register")
      .select("tenant_id, advance_id, employee_id")
      .eq("tenant_id", foreignTenantId)
      .limit(5);
    record(
      "direct salary_advance_register other tenant_id",
      session.label,
      (rawAdv ?? []).length === 0,
      `rows=${(rawAdv ?? []).length}`,
    );

    const { data: rawLoans } = await session.client
      .from("loan_register")
      .select("employee_id, loan_id")
      .like("employee_id", `${foreignPrefix}%`)
      .limit(5);
    record(
      "direct loan_register foreign employee_id prefix",
      session.label,
      (rawLoans ?? []).length === 0,
      `rows=${(rawLoans ?? []).length}`,
    );

    const leaveBal = await fetchLeaveBalancesPageData(
      session.client,
      session.tenantId,
      buScope,
      new Date().getFullYear(),
    );
    const lbForeignEmp = leaveBal.employees.filter((e) =>
      e.employee_id.startsWith(foreignPrefix),
    ).length;
    const lbForeignBal = leaveBal.balances.filter((b) =>
      String(b.employee_id ?? "").startsWith(foreignPrefix),
    ).length;
    record(
      "fetchLeaveBalancesPageData (SSR path)",
      session.label,
      !leaveBal.error && lbForeignEmp === 0 && lbForeignBal === 0,
      leaveBal.error ??
        `employees=${leaveBal.employees.length} balances=${leaveBal.balances.length} foreignEmp=${lbForeignEmp} foreignBal=${lbForeignBal}`,
    );

    const leavePage = await fetchLeavePageData(
      session.client,
      session.tenantId,
      buScope,
    );
    const lpForeignEmp = leavePage.employees.filter((e) =>
      e.employee_id.startsWith(foreignPrefix),
    ).length;
    const lpForeignEntries = leavePage.entries.filter((e) =>
      String(e.employee_id ?? "").startsWith(foreignPrefix),
    ).length;
    record(
      "fetchLeavePageData (SSR path)",
      session.label,
      !leavePage.error && lpForeignEmp === 0 && lpForeignEntries === 0,
      leavePage.error ??
        `employees=${leavePage.employees.length} entries=${leavePage.entries.length} foreignEmp=${lpForeignEmp} foreignEntries=${lpForeignEntries}`,
    );
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
