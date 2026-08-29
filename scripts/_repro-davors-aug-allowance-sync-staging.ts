/**
 * Reproduce Davors Aug 2026 payroll allowance sync exactly as Payroll Processing does.
 * Tests CURRENT working-tree syncProcessingAllowanceLines + HEAD-style upsert.
 *
 *   npx tsx scripts/_repro-davors-aug-allowance-sync-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { syncProcessingAllowanceLines } from "../app/dashboard/hr-payroll/payroll-allowance-lines-utils";
import type {
  AllowanceTypeRow,
  CompensationPolicyRow,
} from "../app/dashboard/administration/compensation-policy-utils";
import { filterEmployeesForPayrollPeriod } from "../app/dashboard/hr-payroll/employee-utils";
import {
  getPeriodEndDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";
import { resolvePayrollPolicyCompensation } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { SalaryRateConfig } from "../app/dashboard/employees/pay-estimate-utils";

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

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  console.log("ENV URL", url);
  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("This repro is for staging (matches .env.local / local next)");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const tenantId = "00000001-0000-4000-8000-000000000001";
  const period = resolveSelectedPeriod(2026, 8);

  const [{ data: employees }, { data: allowanceTypes }, { data: policies }, { data: salaryRates }] =
    await Promise.all([
      admin
        .from("employees")
        .select(
          "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, department, contract_project, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances",
        )
        .eq("tenant_id", tenantId),
      admin.from("allowance_types").select("*").eq("tenant_id", tenantId),
      admin.from("compensation_policy").select("*").eq("tenant_id", tenantId),
      admin.from("salary_rate_config").select("*").eq("tenant_id", tenantId),
    ]);

  const compensationPolicyConfig = {
    salaryRates: (salaryRates as SalaryRateConfig[] | null) ?? [],
    allowanceTypes: (allowanceTypes as AllowanceTypeRow[] | null) ?? [],
    compensationPolicies: (policies as CompensationPolicyRow[] | null) ?? [],
  };

  const forPeriod = filterEmployeesForPayrollPeriod(employees ?? [], 2026, 8);
  console.log("period employees", forPeriod.length);

  // Also probe payroll_processing upsert (same error class if wrong)
  const { error: ppProbe } = await admin.from("payroll_processing").upsert(
    {
      tenant_id: tenantId,
      payroll_month: "2099-02-01",
      employee_id: forPeriod[0]?.employee_id ?? "X",
      days_to_pay: 1,
      status: "Draft",
      basic_salary: 0,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
      overtime_amount: 0,
      bonuses: 0,
      arrears: 0,
      gross_pay: 0,
      employee_ssnit: 0,
      employer_ssnit: 0,
      tier2: 0,
      tier3: 0,
      paye_tax: 0,
      loan_repayment: 0,
      salary_advance: 0,
      welfare_deduction: 0,
      other_deductions: 0,
      absence_deduction: 0,
      total_deductions: 0,
      net_pay: 0,
      daily_rate: 0,
      net_only_adjustment: 0,
    },
    { onConflict: "tenant_id,payroll_month,employee_id", ignoreDuplicates: true },
  );
  console.log("payroll_processing upsert probe =>", ppProbe?.message ?? "OK");
  await admin
    .from("payroll_processing")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("payroll_month", "2099-02-01");

  let failures = 0;
  const asOf = new Date(getPeriodEndDate(2026, 8));
  for (const employee of forPeriod) {
    const resolved = resolvePayrollPolicyCompensation(
      employee,
      compensationPolicyConfig,
      asOf,
    );

    const lines = resolved?.allowance_lines ?? [];
    const codes = lines.map((l) => l.allowance_code);
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    if (dupes.length) {
      console.log("DUPLICATE codes for", employee.staff_id, dupes);
    }

    const result = await syncProcessingAllowanceLines(
      admin,
      period.payrollMonth,
      employee.employee_id,
      lines,
      { tenantId, businessUnitId: null },
    );

    if (result.error) {
      failures += 1;
      console.log(
        "FAIL",
        employee.staff_id,
        employee.employee_id,
        "lines=",
        lines.length,
        "=>",
        result.error,
      );
    }
  }

  console.log(
    failures === 0
      ? `PASS: synced allowances for all ${forPeriod.length} employees (current utils)`
      : `FAIL: ${failures}/${forPeriod.length} employees`,
  );

  // HEAD-style upsert with business_unit_id IN PAYLOAD (not onConflict) — should work
  const sample = forPeriod[0];
  if (sample) {
    const resolved = resolvePayrollPolicyCompensation(
      sample,
      compensationPolicyConfig,
      asOf,
    );
    const lines = resolved?.allowance_lines ?? [];
    const rows = lines.map((line) => ({
      tenant_id: tenantId,
      stage: "processing" as const,
      payroll_month: period.payrollMonth,
      employee_id: sample.employee_id,
      allowance_type_id: line.allowance_type_id || null,
      allowance_code: line.allowance_code,
      allowance_name: line.allowance_name,
      amount: Math.round((Number(line.amount) || 0) * 100) / 100,
      business_unit_id: null as string | null,
    }));
    const { error: headStyle } = await admin
      .from("payroll_allowance_lines")
      .upsert(rows, {
        onConflict: "tenant_id,stage,payroll_month,employee_id,allowance_code",
      });
    console.log(
      "HEAD-style upsert WITH business_unit_id in payload =>",
      headStyle?.message ?? "OK",
    );

    const { error: broken } = await admin.from("payroll_allowance_lines").upsert(
      rows,
      {
        onConflict:
          "tenant_id,stage,payroll_month,employee_id,allowance_code,business_unit_id",
      },
    );
    console.log(
      "BROKEN onConflict (+business_unit_id) =>",
      broken?.message ?? "OK",
    );
  }

  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
