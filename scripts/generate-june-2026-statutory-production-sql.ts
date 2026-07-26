/**
 * Generate production June statutory UPDATE SQL (read-only; no DB writes).
 *
 * Usage:
 *   npx tsx scripts/generate-june-2026-statutory-production-sql.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  calculatePayrollRow,
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  type PayrollEmployeeSource,
  type PayrollTaxConfigs,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import { resolveSelectedPeriod } from "../app/dashboard/hr-payroll/payroll-period-utils";

const PRODUCTION_PROJECT_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const PAYROLL_MONTH = "2026-06-01";

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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function num(value: number | null | undefined): number {
  return Number(value) || 0;
}

function parseArgs(argv: string[]) {
  let envFile = ".env.local.backup";
  let allowProduction = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env-file") envFile = argv[++i] ?? envFile;
    if (arg === "--allow-production") allowProduction = true;
  }
  return { envFile, allowProduction };
}

async function main() {
  const { envFile, allowProduction } = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && key, "Missing URL/key");
  const projectRef = new URL(url).hostname.split(".")[0];
  assert(
    projectRef === PRODUCTION_PROJECT_REF && allowProduction,
    "Require production env + --allow-production",
  );

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const period = resolveSelectedPeriod(2026, 6);

  const [ssnitRes, casualRes, payeRes, historyRes, empRes, procRes] =
    await Promise.all([
      admin
        .from("ssnit_rate_config")
        .select("*")
        .eq("tenant_id", TENANT)
        .order("effective_date", { ascending: false }),
      admin
        .from("casual_tax_rate_config")
        .select("*")
        .eq("tenant_id", TENANT)
        .order("effective_date", { ascending: false }),
      admin
        .from("paye_tax_bands")
        .select("band_order, lower_bound, upper_bound, rate, effective_date")
        .eq("tenant_id", TENANT)
        .order("effective_date", { ascending: false })
        .order("band_order", { ascending: true }),
      admin
        .from("payroll_history")
        .select(
          "id, employee_id, basic_salary, housing_allowance, transport_allowance, other_allowances, overtime_amount, bonuses, arrears, employee_ssnit, employer_ssnit, tier2, paye_tax",
        )
        .eq("tenant_id", TENANT)
        .eq("payroll_month", PAYROLL_MONTH)
        .order("employee_id"),
      admin
        .from("employees")
        .select(
          "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, basic_salary, housing_allowance, transport_allowance, other_allowances, department, contract_project",
        )
        .eq("tenant_id", TENANT),
      admin
        .from("payroll_processing")
        .select("employee_id, days_to_pay")
        .eq("tenant_id", TENANT)
        .eq("payroll_month", PAYROLL_MONTH),
    ]);

  for (const [label, res] of [
    ["ssnit", ssnitRes],
    ["casual", casualRes],
    ["paye", payeRes],
    ["history", historyRes],
    ["employees", empRes],
    ["processing", procRes],
  ] as const) {
    if (res.error) throw new Error(`${label}: ${res.error.message}`);
  }

  const taxConfigs: PayrollTaxConfigs = {
    ssnitRows: mapSsnitConfigRows(ssnitRes.data ?? []),
    casualRows: mapCasualTaxConfigRows(casualRes.data ?? []),
    payeBands: mapPayrollPayeBandRows(payeRes.data ?? []),
  };

  const employeesById = new Map(
    ((empRes.data as PayrollEmployeeSource[] | null) ?? []).map((e) => [
      e.employee_id,
      e,
    ]),
  );
  const daysById = new Map(
    (procRes.data ?? []).map((p) => [p.employee_id, Number(p.days_to_pay)]),
  );

  const history = historyRes.data ?? [];
  assert(history.length === 20, `Expected 20 rows, got ${history.length}`);

  const valueLines: string[] = [];
  const totals = {
    employee_ssnit: 0,
    employer_ssnit: 0,
    tier2: 0,
    paye_tax: 0,
  };

  for (const row of history) {
    const emp = employeesById.get(row.employee_id);
    assert(emp, `Missing employee ${row.employee_id}`);
    const daysToPay = daysById.get(row.employee_id);
    assert(
      daysToPay !== undefined && !Number.isNaN(daysToPay),
      `Missing days_to_pay for ${row.employee_id}`,
    );

    const calculated = calculatePayrollRow(
      {
        ...emp,
        basic_salary: row.basic_salary,
        housing_allowance: row.housing_allowance,
        transport_allowance: row.transport_allowance,
        other_allowances: row.other_allowances,
      },
      period,
      taxConfigs,
      {
        absenceCount: 0,
        overtimeAmount: num(row.overtime_amount),
        loanRepayment: 0,
      },
      {
        days_to_pay: daysToPay,
        bonuses: num(row.bonuses),
        arrears: num(row.arrears),
        salary_advance: 0,
        welfare_deduction: 0,
        other_deductions: 0,
      },
    );

    totals.employee_ssnit = round2(
      totals.employee_ssnit + calculated.employee_ssnit,
    );
    totals.employer_ssnit = round2(
      totals.employer_ssnit + calculated.employer_ssnit,
    );
    totals.tier2 = round2(totals.tier2 + calculated.tier2);
    totals.paye_tax = round2(totals.paye_tax + calculated.paye_tax);

    valueLines.push(
      `    ('${row.id}'::uuid, ${calculated.employee_ssnit}, ${calculated.employer_ssnit}, ${calculated.tier2}, ${calculated.paye_tax})`,
    );
  }

  assert(totals.employee_ssnit === 188.38, `emp ${totals.employee_ssnit}`);
  assert(totals.employer_ssnit === 274.03, `er ${totals.employer_ssnit}`);
  assert(totals.tier2 === 171.28, `tier2 ${totals.tier2}`);
  assert(totals.paye_tax === 275.03, `paye ${totals.paye_tax}`);

  const oneShotPath = resolve(
    process.cwd(),
    "scripts/fix-june-2026-statutory-production.sql",
  );
  writeFileSync(
    oneShotPath,
    `-- ONE-SHOT production SQL: June 2026 Davors statutory recalculation
-- Project: ${PRODUCTION_PROJECT_REF}
-- Tenant: ${TENANT}
-- Period: ${PAYROLL_MONTH}
--
-- Paste into Supabase SQL Editor (production) and Run.
-- Expected totals: emp=188.38 er=274.03 tier2=171.28 paye=275.03 er+tier2=445.31
-- Does NOT modify salary/net pay.

begin;

alter table payroll_history disable trigger trg_protect_locked_payroll;

update payroll_history as ph set
  employee_ssnit = v.employee_ssnit,
  employer_ssnit = v.employer_ssnit,
  tier2 = v.tier2,
  paye_tax = v.paye_tax
from (
  values
${valueLines.join(",\n")}
) as v(id, employee_ssnit, employer_ssnit, tier2, paye_tax)
where ph.tenant_id = '${TENANT}'::uuid
  and ph.payroll_month = '${PAYROLL_MONTH}'::date
  and ph.id = v.id;

alter table payroll_history enable trigger trg_protect_locked_payroll;

select
  round(sum(employee_ssnit)::numeric, 2) as employee_ssnit,
  round(sum(employer_ssnit)::numeric, 2) as employer_ssnit,
  round(sum(tier2)::numeric, 2) as tier2,
  round(sum(paye_tax)::numeric, 2) as paye_tax,
  round(sum(employer_ssnit + tier2)::numeric, 2) as er_plus_tier2,
  count(*) as row_count
from payroll_history
where tenant_id = '${TENANT}'::uuid
  and payroll_month = '${PAYROLL_MONTH}'::date;

commit;
`,
    "utf8",
  );

  const rpcPath = resolve(
    process.cwd(),
    "scripts/115_admin_update_payroll_history_statutory.sql",
  );
  writeFileSync(
    rpcPath,
    `-- Reusable SECURITY DEFINER helper for locked payroll_history statutory patches.
create or replace function public.admin_update_payroll_history_statutory(
  p_tenant_id uuid,
  p_payroll_month date,
  p_rows jsonb
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  n integer := 0;
  matched integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  alter table payroll_history disable trigger trg_protect_locked_payroll;

  for r in select value from jsonb_array_elements(p_rows)
  loop
    update payroll_history
    set
      employee_ssnit = coalesce((r->>'employee_ssnit')::numeric, employee_ssnit),
      employer_ssnit = coalesce((r->>'employer_ssnit')::numeric, employer_ssnit),
      tier2 = coalesce((r->>'tier2')::numeric, tier2),
      paye_tax = coalesce((r->>'paye_tax')::numeric, paye_tax)
    where tenant_id = p_tenant_id
      and payroll_month = p_payroll_month
      and id = (r->>'id')::uuid;

    get diagnostics matched = row_count;
    if matched <> 1 then
      raise exception 'Expected 1 row for id %, matched %', r->>'id', matched;
    end if;
    n := n + 1;
  end loop;

  alter table payroll_history enable trigger trg_protect_locked_payroll;
  return n;
exception
  when others then
    begin
      alter table payroll_history enable trigger trg_protect_locked_payroll;
    exception when others then
      null;
    end;
    raise;
end;
$$;

revoke all on function public.admin_update_payroll_history_statutory(uuid, date, jsonb) from public;
grant execute on function public.admin_update_payroll_history_statutory(uuid, date, jsonb) to service_role;
`,
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        project_ref: projectRef,
        totals,
        one_shot_sql: oneShotPath,
        rpc_sql: rpcPath,
        rows: history.length,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
