// @ts-nocheck
/**
 * Read-only: compare OLD vs NEW salary_rate_config basic lookup impact on
 * resolved compensation (allowances unchanged) for payroll-eligible employees.
 *
 * Usage:
 *   npx tsx scripts/tmp/payroll-bu-salary-lookup-regression-readonly.ts --env-file .env.local.production-backup-2026-08-25 --label PRODUCTION
 *   npx tsx scripts/tmp/payroll-bu-salary-lookup-regression-readonly.ts --env-file .env.staging.local --label STAGING
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { resolveDatabaseUrl } from "../resolve-database-url.mjs";
import { findMatchingSalaryRate } from "../../app/dashboard/employees/pay-estimate-utils";
import { resolveEmployeeCompensation } from "../../app/dashboard/administration/compensation-policy-utils";
import {
  filterEmployeesForPayrollPeriod,
} from "../../app/dashboard/hr-payroll/employee-utils";
import { getPeriodEndDate } from "../../app/dashboard/hr-payroll/payroll-period-utils";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

/** Main-branch behaviour: ignore business_unit_id; latest effective_date <= asOf. */
function findMatchingSalaryRateOld(
  rates,
  position,
  employmentType,
  shift,
  asOf = new Date(),
) {
  if (!position || !employmentType || !shift) {
    return null;
  }
  const asOfDay = asOf.toISOString().slice(0, 10);
  const matches = rates.filter(
    (rate) =>
      rate.position === position &&
      rate.employment_type === employmentType &&
      rate.shift === shift &&
      rate.effective_date.slice(0, 10) <= asOfDay,
  );
  if (matches.length === 0) {
    return null;
  }
  matches.sort((a, b) =>
    b.effective_date.slice(0, 10).localeCompare(a.effective_date.slice(0, 10)),
  );
  return matches[0].basic_salary;
}

function resolveCompensationOld(
  salaryRates,
  policies,
  allowanceTypes,
  position,
  employmentType,
  shift,
  asOf,
) {
  const matchedBasic = findMatchingSalaryRateOld(
    salaryRates,
    (position ?? "").trim(),
    (employmentType ?? "").trim(),
    (shift ?? "").trim(),
    asOf,
  );
  return resolveEmployeeCompensation(
    salaryRates.map((r) => ({
      ...r,
      basic_salary: r.basic_salary,
    })),
    policies,
    allowanceTypes,
    position,
    employmentType,
    shift,
    asOf,
    "__FORCE_OLD_BASIC__",
  );
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function moneyEqual(a, b) {
  return Math.abs(round2(a) - round2(b)) < 0.005;
}

function resolveWithExplicitBasic(
  salaryRates,
  policies,
  allowanceTypes,
  position,
  employmentType,
  shift,
  asOf,
  basicSalary,
) {
  const pos = (position ?? "").trim();
  const empType = (employmentType ?? "").trim();
  const sh = (shift ?? "").trim();
  const base = resolveEmployeeCompensation(
    salaryRates,
    policies,
    allowanceTypes,
    position,
    employmentType,
    shift,
    asOf,
    null,
  );
  const basic =
    basicSalary === null || basicSalary === undefined
      ? 0
      : round2(basicSalary);
  return {
    ...base,
    basic_salary: basic,
    gross_monthly: round2(basic + base.total_allowances),
  };
}

function formatAllowances(lines) {
  return lines
    .map((l) => `${l.allowance_code}=${round2(l.amount)}`)
    .join(", ");
}

function explainSalaryDiff(
  salaryRates,
  employee,
  asOfDay,
  oldBasic,
  newBasic,
  buNames,
) {
  const pos = (employee.position ?? "").trim();
  const emp = (employee.employment_type ?? "").trim();
  const sh = (employee.shift ?? "").trim();
  const empBu = employee.business_unit_id?.trim() || null;

  const candidates = salaryRates
    .filter(
      (r) =>
        r.position === pos &&
        r.employment_type === emp &&
        r.shift === sh &&
        r.effective_date.slice(0, 10) <= asOfDay,
    )
    .sort((a, b) => {
      const d = b.effective_date
        .slice(0, 10)
        .localeCompare(a.effective_date.slice(0, 10));
      if (d !== 0) return d;
      return String(a.business_unit_id ?? "").localeCompare(
        String(b.business_unit_id ?? ""),
      );
    });

  const buLabel = (id) => {
    if (id == null || id === "") return "NULL (workspace default)";
    return buNames.get(id) ?? id;
  };

  const oldPick = candidates[0];
  const newAmount = findMatchingSalaryRate(
    salaryRates,
    pos,
    emp,
    sh,
    new Date(asOfDay + "T12:00:00.000Z"),
    empBu,
  );

  const newPick = candidates
    .filter((r) => {
      const rateBu = r.business_unit_id?.trim() || null;
      if (empBu) {
        if (rateBu === empBu) return true;
        if (rateBu === null) return true;
        return false;
      }
      return rateBu === null;
    })
    .sort((a, b) => {
      const rank = (r) => {
        const rateBu = r.business_unit_id?.trim() || null;
        if (empBu && rateBu === empBu) return 0;
        if (rateBu === null) return 1;
        return 2;
      };
      const rd = rank(a) - rank(b);
      if (rd !== 0) return rd;
      return b.effective_date
        .slice(0, 10)
        .localeCompare(a.effective_date.slice(0, 10));
    })[0];

  const lines = [
    `  Candidate salary_rate_config rows (as of ${asOfDay}):`,
    ...candidates.map(
      (r) =>
        `    effective=${r.effective_date.slice(0, 10)} BU=${buLabel(r.business_unit_id)} basic=${round2(r.basic_salary)}`,
    ),
    `  OLD picked: basic=${round2(oldBasic)} (latest effective_date globally; BU ignored${oldPick ? ` → row BU=${buLabel(oldPick.business_unit_id)}` : ""})`,
    `  NEW picked: basic=${round2(newAmount ?? 0)} (employee BU=${buLabel(empBu)} first, then NULL-BU${newPick ? ` → row BU=${buLabel(newPick.business_unit_id)}` : ""})`,
  ];

  const hasFacilitiesAndNull =
    empBu &&
    candidates.some((r) => !r.business_unit_id) &&
    candidates.some((r) => r.business_unit_id === empBu);

  if (hasFacilitiesAndNull && oldBasic !== newBasic) {
    lines.push(
      "  Note: Both unit-specific and NULL-BU rates exist for this combo; OLD and NEW intentionally diverge.",
    );
  } else if (oldBasic !== newBasic) {
    lines.push(
      "  Note: Divergence from competing rows at the same or different effective dates / BUs.",
    );
  }

  return lines.join("\n");
}

async function runForEnv(label, envFile) {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("SUPABASE") || key === "DATABASE_URL" || key === "POSTGRES_URL") {
      delete process.env[key];
    }
  }
  loadEnvForce(envFile);
  const url = resolveDatabaseUrl();
  if (!url) {
    throw new Error(`No DATABASE_URL for ${envFile}`);
  }

  const client = new pg.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const ref = (() => {
    try {
      return new URL(url.replace(/^postgres:/, "postgresql:")).hostname.split(".")[1] ?? url;
    } catch {
      return url.slice(0, 40);
    }
  })();

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${label}  (project host contains: ${ref})`);
  console.log(`${"=".repeat(72)}`);

  function isoDate(value) {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }

  const tenantsRes = await client.query(
    `SELECT id::text, name FROM public.tenants ORDER BY name`,
  );
  const employeesRes = await client.query(`
        SELECT tenant_id::text, employee_id, staff_id, full_name,
               position, employment_type, shift,
               employment_status, date_hired, appointment_end_date,
               business_unit_id::text
        FROM public.employees
      `);
  const ratesRes = await client.query(`
        SELECT id::text, tenant_id::text, business_unit_id::text,
               position, employment_type, shift, basic_salary, effective_date::text
        FROM public.salary_rate_config
      `);
  const policiesRes = await client.query(`
        SELECT id::text, tenant_id::text, position, employment_type, shift,
               allowance_type_id::text, amount
        FROM public.compensation_policy
      `);
  const typesRes = await client.query(`
        SELECT id::text, tenant_id::text, code, name, is_active, sort_order
        FROM public.allowance_types
      `);
  const unitsRes = await client.query(`
        SELECT id::text, tenant_id::text, name FROM public.business_units
      `);

  const buNames = new Map();
  for (const u of unitsRes.rows) {
    buNames.set(u.id, u.name);
  }

  const ratesByTenant = new Map();
  for (const r of ratesRes.rows) {
    const list = ratesByTenant.get(r.tenant_id) ?? [];
    list.push({
      id: r.id,
      position: r.position,
      employment_type: r.employment_type,
      shift: r.shift,
      basic_salary: Number(r.basic_salary),
      effective_date: r.effective_date,
      business_unit_id: r.business_unit_id,
    });
    ratesByTenant.set(r.tenant_id, list);
  }

  const policiesByTenant = new Map();
  for (const p of policiesRes.rows) {
    const list = policiesByTenant.get(p.tenant_id) ?? [];
    list.push({
      id: p.id,
      position: p.position,
      employment_type: p.employment_type,
      shift: p.shift,
      allowance_type_id: p.allowance_type_id,
      amount: Number(p.amount),
    });
    policiesByTenant.set(p.tenant_id, list);
  }

  const typesByTenant = new Map();
  for (const t of typesRes.rows) {
    const list = typesByTenant.get(t.tenant_id) ?? [];
    list.push({
      id: t.id,
      code: t.code,
      name: t.name,
      is_active: t.is_active,
      sort_order: t.sort_order,
    });
    typesByTenant.set(t.tenant_id, list);
  }

  const employeesByTenant = new Map();
  for (const e of employeesRes.rows) {
    const list = employeesByTenant.get(e.tenant_id) ?? [];
    list.push({
      ...e,
      date_hired: isoDate(e.date_hired),
      appointment_end_date: isoDate(e.appointment_end_date),
    });
    employeesByTenant.set(e.tenant_id, list);
  }

  const periods = [
    { year: 2026, month: 10, label: "October 2026" },
    { year: 2026, month: 11, label: "November 2026" },
  ];

  const allDiffs = [];

  for (const period of periods) {
    console.log(`\n--- ${period.label} ---\n`);
    const asOfDay = getPeriodEndDate(period.year, period.month);
    const asOf = new Date(asOfDay + "T23:59:59.000Z");

    for (const tenant of tenantsRes.rows) {
      const tenantId = tenant.id;
      const employees = employeesByTenant.get(tenantId) ?? [];
      const eligible = filterEmployeesForPayrollPeriod(
        employees,
        period.year,
        period.month,
      );
      const salaryRates = ratesByTenant.get(tenantId) ?? [];
      const policies = policiesByTenant.get(tenantId) ?? [];
      const allowanceTypes = typesByTenant.get(tenantId) ?? [];

      let diffCount = 0;
      for (const emp of eligible) {
        const oldBasic = findMatchingSalaryRateOld(
          salaryRates,
          emp.position,
          emp.employment_type,
          emp.shift,
          asOf,
        );
        const newBasic = findMatchingSalaryRate(
          salaryRates,
          emp.position,
          emp.employment_type,
          emp.shift,
          asOf,
          emp.business_unit_id,
        );

        const oldResolved = resolveWithExplicitBasic(
          salaryRates,
          policies,
          allowanceTypes,
          emp.position,
          emp.employment_type,
          emp.shift,
          asOf,
          oldBasic,
        );
        const newResolved = resolveWithExplicitBasic(
          salaryRates,
          policies,
          allowanceTypes,
          emp.position,
          emp.employment_type,
          emp.shift,
          asOf,
          newBasic,
        );

        const basicDiff = !moneyEqual(
          oldResolved.basic_salary,
          newResolved.basic_salary,
        );
        const grossDiff = !moneyEqual(
          oldResolved.gross_monthly,
          newResolved.gross_monthly,
        );
        const allowanceDiff = oldResolved.allowances.some((line, i) => {
          const other = newResolved.allowances[i];
          return (
            !other ||
            line.allowance_code !== other.allowance_code ||
            !moneyEqual(line.amount, other.amount)
          );
        });

        if (basicDiff || grossDiff || allowanceDiff) {
          diffCount += 1;
          allDiffs.push({
            env: label,
            period: period.label,
            tenantId,
            tenantName: tenant.name,
            employee: emp,
            oldResolved,
            newResolved,
            asOfDay,
            salaryRates,
          });
        }
      }

      console.log(
        `${tenant.name} (${tenantId}): compared ${eligible.length} payroll-eligible employees, ${diffCount} with any difference`,
      );
    }
  }

  if (allDiffs.length === 0) {
    console.log(`\n${label}: No differences for Oct/Nov 2026 across all tenants.`);
  } else {
    console.log(`\n${label}: ${allDiffs.length} employee-period row(s) with differences:\n`);
    for (const d of allDiffs) {
      const emp = d.employee;
      const bu =
        emp.business_unit_id == null || emp.business_unit_id === ""
          ? "NULL"
          : `${buNames.get(emp.business_unit_id) ?? emp.business_unit_id} (${emp.business_unit_id})`;
      console.log(
        `[${d.period}] tenant=${d.tenantName} (${d.tenantId}) employee_id=${emp.employee_id} staff_id=${emp.staff_id} name=${emp.full_name}`,
      );
      console.log(`  position=${emp.position ?? "—"} type=${emp.employment_type ?? "—"} shift=${emp.shift ?? "—"} BU=${bu}`);
      console.log(
        `  OLD: basic=${round2(d.oldResolved.basic_salary)} allowances=[${formatAllowances(d.oldResolved.allowances)}] gross=${round2(d.oldResolved.gross_monthly)}`,
      );
      console.log(
        `  NEW: basic=${round2(d.newResolved.basic_salary)} allowances=[${formatAllowances(d.newResolved.allowances)}] gross=${round2(d.newResolved.gross_monthly)}`,
      );
      console.log(
        explainSalaryDiff(
          d.salaryRates,
          emp,
          d.asOfDay,
          d.oldResolved.basic_salary,
          d.newResolved.basic_salary,
          buNames,
        ),
      );
      console.log("");
    }
  }

  await client.end();
}

const args = process.argv.slice(2);
const envIdx = args.indexOf("--env-file");
const labelIdx = args.indexOf("--label");
const envFile =
  envIdx >= 0 ? args[envIdx + 1] : ".env.local.production-backup-2026-08-25";
const label = labelIdx >= 0 ? args[labelIdx + 1] : "ENV";

runForEnv(label, envFile).catch((e) => {
  console.error(e);
  process.exit(1);
});
