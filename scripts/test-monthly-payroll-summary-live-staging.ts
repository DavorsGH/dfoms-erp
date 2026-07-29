/**
 * Staging: Monthly Payroll Summary open-period live recalculation.
 *
 *   npx tsx scripts/test-monthly-payroll-summary-live-staging.ts --env-file .env.staging.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildManualInputsFromRow,
  calculateLoanRepaymentForEmployee,
  calculatePayrollRow,
  countAbsencesForStaff,
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  resolvePayrollPolicyCompensation,
  sumOvertimeForEmployee,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  getPeriodEndDate,
  getPeriodStartDate,
  isMonthClosed,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";
import { buildMonthlyPayrollSummaryReport } from "../app/dashboard/reports/hr-reports-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const BUMP = 25;

function loadEnvForce(filePath) {
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function almostEqual(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

async function main() {
  const argv = process.argv.slice(2);
  const envIdx = argv.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && argv[envIdx + 1] ? argv[envIdx + 1] : ".env.staging.local";
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging: ${url}`);
  assert(key, "Missing service role key");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  // August is Open on staging (July Partially Locked).
  const year = 2026;
  const month = 8;
  const period = resolveSelectedPeriod(year, month);
  const payrollMonth = period.payrollMonth;
  const periodStart = getPeriodStartDate(year, month);
  const periodEnd = getPeriodEndDate(year, month);

  const [
    { data: employees },
    { data: history },
    { data: processing },
    { data: closes },
    { data: attendance },
    { data: overtime },
    { data: loans },
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows },
  ] = await Promise.all([
    admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, department, contract_project, basic_salary, housing_allowance, transport_allowance, other_allowances",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("payroll_history")
      .select(
        "payroll_month, employee_id, basic_salary, gross_pay, employee_ssnit, employer_ssnit, tier2, paye_tax, loan_repayment, total_deductions, net_pay",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", payrollMonth),
    admin.from("month_end_close").select("*").eq("tenant_id", DAVORS),
    admin
      .from("attendance_register")
      .select("staff_id, date, attendance_status")
      .eq("tenant_id", DAVORS)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin
      .from("overtime_register")
      .select("employee_id, date, overtime_amount")
      .eq("tenant_id", DAVORS)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin.from("loan_register").select("*").eq("tenant_id", DAVORS),
    admin
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false }),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", DAVORS),
    admin.from("compensation_policy").select("*").eq("tenant_id", DAVORS),
    admin
      .from("ssnit_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false }),
    admin
      .from("casual_tax_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false }),
    admin
      .from("paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
  ]);

  assert((processing?.length ?? 0) > 0, "Need August Open processing rows");
  const closeAug =
    (closes ?? []).find((c) => c.month?.slice(0, 10) === payrollMonth) ?? null;
  assert(
    !isMonthClosed(closeAug),
    "August must be open/draft for this test",
  );

  const liveContext = {
    attendance: attendance ?? [],
    overtime: overtime ?? [],
    loans: loans ?? [],
    taxConfigs: {
      ssnitRows: mapSsnitConfigRows(ssnitRows ?? []),
      casualRows: mapCasualTaxConfigRows(casualRows ?? []),
      payeBands: mapPayrollPayeBandRows(payeRows ?? []),
    },
    compensationPolicyConfig: {
      salaryRates: salaryRates ?? [],
      allowanceTypes: allowanceTypes ?? [],
      compensationPolicies: compensationPolicies ?? [],
    },
  };

  const empById = new Map((employees ?? []).map((e) => [e.employee_id, e]));

  // Pick Cleaning Supervisors if available
  let policyEmp = (processing ?? [])
    .map((r) => ({ row: r, emp: empById.get(r.employee_id) }))
    .find(
      (x) =>
        x.emp?.position === "Cleaning Supervisors" &&
        x.emp?.employment_type === "Full-Time",
    );
  if (!policyEmp) {
    policyEmp = {
      row: processing[0],
      emp: empById.get(processing[0].employee_id),
    };
  }
  assert(policyEmp.emp, "Employee missing for policy test");

  // Manual-edit employee: different from policyEmp if possible
  let manualEmp = (processing ?? [])
    .map((r) => ({ row: r, emp: empById.get(r.employee_id) }))
    .find((x) => x.emp && x.emp.employee_id !== policyEmp.emp.employee_id);
  if (!manualEmp) manualEmp = policyEmp;

  const processingForManual = (processing ?? []).map((r) =>
    r.employee_id === manualEmp.emp.employee_id
      ? {
          ...r,
          days_to_pay: 20,
          arrears: 50,
          // Stale stored net — report must ignore for open months
          net_pay: 1.23,
          gross_pay: 1.23,
          basic_salary: 1.23,
        }
      : r,
  );

  const reportBefore = buildMonthlyPayrollSummaryReport(
    year,
    month,
    employees ?? [],
    closes ?? [],
    history ?? [],
    processingForManual,
    liveContext,
  );
  assert(reportBefore.isDraft, "Expected draft/open August");

  const manualRow = reportBefore.rows.find(
    (r) => r.staffId === manualEmp.emp.staff_id,
  );
  assert(manualRow, "Manual employee missing from report");

  const expectedManual = calculatePayrollRow(
    manualEmp.emp,
    period,
    liveContext.taxConfigs,
    {
      absenceCount: countAbsencesForStaff(
        attendance ?? [],
        manualEmp.emp.staff_id,
        year,
        month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        overtime ?? [],
        manualEmp.emp.employee_id,
        year,
        month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        loans ?? [],
        manualEmp.emp.employee_id,
      ),
    },
    buildManualInputsFromRow(
      processingForManual.find(
        (r) => r.employee_id === manualEmp.emp.employee_id,
      ),
      period.totalWorkingDays,
    ),
    resolvePayrollPolicyCompensation(
      manualEmp.emp,
      liveContext.compensationPolicyConfig,
      new Date(periodEnd),
    ),
  );
  console.log(
    `Manual ${manualEmp.emp.staff_id}: reportNet=${manualRow.netPay} expected=${expectedManual.net_pay} days=20 arrears=50`,
  );
  assert(
    almostEqual(manualRow.netPay, expectedManual.net_pay),
    "Manual days/arrears not reflected",
  );
  assert(!almostEqual(manualRow.netPay, 1.23), "Must not use planted stored net");
  console.log("PASS manuals preserved on open-period live recalc");

  // Policy bump without touching payroll_processing
  const { data: polRows } = await admin
    .from("compensation_policy")
    .select("id, amount")
    .eq("tenant_id", DAVORS)
    .eq("position", policyEmp.emp.position)
    .eq("employment_type", policyEmp.emp.employment_type)
    .eq("shift", policyEmp.emp.shift);
  const bumpTarget =
    (polRows ?? []).find((r) => Number(r.amount) > 0) ?? (polRows ?? [])[0];
  assert(bumpTarget, "No policy row to bump");
  const originalAmount = Number(bumpTarget.amount) || 0;

  const beforePolicyRow = reportBefore.rows.find(
    (r) => r.staffId === policyEmp.emp.staff_id,
  );
  assert(beforePolicyRow, "Policy employee missing from report");
  const storedNet = Number(policyEmp.row.net_pay) || 0;

  try {
    const { error: updErr } = await admin
      .from("compensation_policy")
      .update({ amount: originalAmount + BUMP })
      .eq("id", bumpTarget.id);
    assert(!updErr, updErr?.message ?? "bump failed");

    const { data: policiesAfter } = await admin
      .from("compensation_policy")
      .select("*")
      .eq("tenant_id", DAVORS);
    const liveAfter = {
      ...liveContext,
      compensationPolicyConfig: {
        ...liveContext.compensationPolicyConfig,
        compensationPolicies: policiesAfter ?? [],
      },
    };

    // Same processing rows (unchanged in DB for policyEmp — we only mutated in-memory manuals for manualEmp)
    const reportAfter = buildMonthlyPayrollSummaryReport(
      year,
      month,
      employees ?? [],
      closes ?? [],
      history ?? [],
      processing ?? [], // original DB-shaped rows, no PP update
      liveAfter,
    );
    const afterRow = reportAfter.rows.find(
      (r) => r.staffId === policyEmp.emp.staff_id,
    );
    assert(afterRow, "Policy employee missing after bump");

    const expectedAfter = calculatePayrollRow(
      policyEmp.emp,
      period,
      liveAfter.taxConfigs,
      {
        absenceCount: countAbsencesForStaff(
          attendance ?? [],
          policyEmp.emp.staff_id,
          year,
          month,
        ),
        overtimeAmount: sumOvertimeForEmployee(
          overtime ?? [],
          policyEmp.emp.employee_id,
          year,
          month,
        ),
        loanRepayment: calculateLoanRepaymentForEmployee(
          loans ?? [],
          policyEmp.emp.employee_id,
        ),
      },
      buildManualInputsFromRow(policyEmp.row, period.totalWorkingDays),
      resolvePayrollPolicyCompensation(
        policyEmp.emp,
        liveAfter.compensationPolicyConfig,
        new Date(periodEnd),
      ),
    ).net_pay;

    console.log(
      `Policy ${policyEmp.emp.staff_id}: beforeReport=${beforePolicyRow.netPay} afterReport=${afterRow.netPay} storedPP=${storedNet} expectedLive=${expectedAfter}`,
    );
    assert(
      almostEqual(afterRow.netPay, expectedAfter),
      "After bump report != live expected",
    );
    assert(
      !almostEqual(afterRow.netPay, beforePolicyRow.netPay),
      "Report net did not change after Salary Settings bump",
    );
    // Stored PP net should be unchanged in DB
    const { data: ppCheck } = await admin
      .from("payroll_processing")
      .select("net_pay")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", payrollMonth)
      .eq("employee_id", policyEmp.emp.employee_id)
      .maybeSingle();
    assert(
      almostEqual(Number(ppCheck?.net_pay), storedNet),
      "payroll_processing was mutated — report must be display-only",
    );
    console.log(
      "PASS open-period report follows Salary Settings without PP resync; DB row unchanged",
    );

    // Locked path unchanged: June if locked uses history stored
    const juneClose =
      (closes ?? []).find((c) => c.month?.slice(0, 10) === "2026-06-01") ?? null;
    if (isMonthClosed(juneClose)) {
      const juneReport = buildMonthlyPayrollSummaryReport(
        2026,
        6,
        employees ?? [],
        closes ?? [],
        history ?? [],
        processing ?? [],
        liveAfter,
      );
      assert(!juneReport.isDraft, "June should be locked/non-draft");
      const hist = (history ?? []).filter(
        (r) => r.payroll_month?.slice(0, 10) === "2026-06-01",
      );
      if (hist.length > 0 && juneReport.rows.length > 0) {
        const h0 = hist[0];
        const r0 = juneReport.rows.find((r) => {
          const emp = empById.get(h0.employee_id);
          return emp && r.staffId === emp.staff_id;
        });
        if (r0) {
          assert(
            almostEqual(r0.netPay, Number(h0.net_pay) || 0),
            "Locked month must still use payroll_history net_pay",
          );
          console.log(
            `PASS locked June still uses payroll_history (sample ${r0.staffId} net=${r0.netPay})`,
          );
        }
      }
    }
  } finally {
    const { error: restoreErr } = await admin
      .from("compensation_policy")
      .update({ amount: originalAmount })
      .eq("id", bumpTarget.id);
    if (restoreErr) throw restoreErr;
    console.log(`Restored policy ${bumpTarget.id} → ${originalAmount}`);
  }

  console.log("\nAll monthly payroll summary live-staging checks passed.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
