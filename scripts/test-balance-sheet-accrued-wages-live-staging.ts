/**
 * Staging: Balance Sheet Accrued Wages — open months live-recalc;
 * locked months stay on payroll_history. Also re-checks FY2026 BS/CF cash
 * parity and A = L+E for all 12 months.
 *
 *   npx tsx scripts/test-balance-sheet-accrued-wages-live-staging.ts --env-file .env.staging.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  mergePayrollWagesSources,
  calculateAccruedWagesPayableByMonth,
} from "../app/dashboard/finance/accrued-wages-utils";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import {
  buildManualInputsFromRow,
  calculateLoanRepaymentForEmployee,
  calculatePayrollRow,
  countAbsencesForStaff,
  resolvePayrollPolicyCompensation,
  sumOvertimeForEmployee,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  getPeriodEndDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const YEAR = 2026;
const BUMP = 25;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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
async function fetchPayrollHistoryWagesForTenant(
  admin: any,
  tenantId: string,
) {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!preferred.error) {
    return preferred.data ?? [];
  }
  if (!String(preferred.error.message).includes("net_only_adjustment")) {
    throw new Error(`payroll_history: ${preferred.error.message}`);
  }
  console.warn(
    "WARN: payroll_history.net_only_adjustment missing — apply scripts/116_payroll_net_only_adjustment.sql on staging; using net_pay only",
  );
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) {
    throw new Error(`payroll_history: ${fallback.error.message}`);
  }
  return (fallback.data ?? []).map((row) => ({
    ...row,
    net_only_adjustment: 0,
  }));
}


function almostEqual(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function roundCurrency(value) {
  return Math.round(Number(value) * 100) / 100;
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

  // August is Open on staging (July Partially Locked → history wins).
  const openMonth = 8;
  const lockedHistoryMonth = 7;
  const openPeriod = resolveSelectedPeriod(YEAR, openMonth);
  const openPayrollMonth = openPeriod.payrollMonth;
  const lockedPayrollMonth = resolveSelectedPeriod(
    YEAR,
    lockedHistoryMonth,
  ).payrollMonth;

  const [
    { data: _historyPlaceholder },
    { data: processing },
    { data: closes },
    { data: expenses },
    { data: income },
    { data: fixedAssets },
    { data: payables },
    { data: capital },
    { data: manual },
    { data: taxLedger },
    { data: invConfig },
    { data: rawPurchases },
    { data: productPurchases },
    liveBundle,
  ] = await Promise.all([
    Promise.resolve({ data: null as null, error: null as null }),
    admin.from("payroll_processing").select("*").eq("tenant_id", DAVORS),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
      .eq("tenant_id", DAVORS),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", DAVORS),
    admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", DAVORS),
    admin
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status")
      .eq("tenant_id", DAVORS)
      .eq("status", "open"),
    admin
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", DAVORS)
      .maybeSingle(),
    admin
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", DAVORS),
    admin
      .from("product_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", DAVORS),
    fetchPayrollLiveRecalcBundle(admin, { tenantId: DAVORS }),
  ]);

  assert(!liveBundle.error, liveBundle.error ?? "live bundle failed");
  void _historyPlaceholder;
  const history = await fetchPayrollHistoryWagesForTenant(admin, DAVORS);
  assert((processing ?? []).length > 0, "No payroll_processing rows");
  assert(
    (processing ?? []).some(
      (r) => String(r.payroll_month).slice(0, 10) === openPayrollMonth,
    ),
    `No open-month processing for ${openPayrollMonth}`,
  );
  assert(
    (history ?? []).some(
      (r) => String(r.payroll_month).slice(0, 10) === lockedPayrollMonth,
    ),
    `No history for locked month ${lockedPayrollMonth}`,
  );

  const storedMerged = mergePayrollWagesSources(history ?? [], processing ?? []);
  const liveMerged = mergePayrollWagesWithLiveOpenMonths(
    history ?? [],
    processing ?? [],
    liveBundle.employees,
    liveBundle.liveContext,
  );

  const accruedStored = calculateAccruedWagesPayableByMonth(
    storedMerged,
    expenses ?? [],
    YEAR,
    closes ?? [],
  );
  const accruedLive = calculateAccruedWagesPayableByMonth(
    liveMerged,
    expenses ?? [],
    YEAR,
    closes ?? [],
  );

  // Locked month Accrued Wages must be identical (history path).
  const lockedIdx = lockedHistoryMonth - 1;
  console.log(
    `Locked ${MONTH_LABELS[lockedIdx]} Accrued Wages: stored=${accruedStored[lockedIdx]} live=${accruedLive[lockedIdx]}`,
  );
  assert(
    almostEqual(accruedStored[lockedIdx], accruedLive[lockedIdx]),
    "Locked-month Accrued Wages must not change",
  );
  console.log("PASS locked-month Accrued Wages unchanged");

  // Pick an August processing employee with a bumpable compensation policy.
  const openRows = (processing ?? []).filter(
    (r) => String(r.payroll_month).slice(0, 10) === openPayrollMonth,
  );
  let policyEmp = null;
  for (const row of openRows) {
    const emp = liveBundle.employees.find(
      (e) => e.employee_id === row.employee_id,
    );
    if (!emp?.position || !emp.employment_type || !emp.shift) continue;
    const { data: polRows } = await admin
      .from("compensation_policy")
      .select("id, amount")
      .eq("tenant_id", DAVORS)
      .eq("position", emp.position)
      .eq("employment_type", emp.employment_type)
      .eq("shift", emp.shift);
    const bumpTarget =
      (polRows ?? []).find((r) => Number(r.amount) > 0) ?? (polRows ?? [])[0];
    if (bumpTarget) {
      policyEmp = { emp, row, bumpTarget };
      break;
    }
  }
  assert(policyEmp, "No open-month employee with bumpable Salary Settings");

  const periodEnd = getPeriodEndDate(YEAR, openMonth);
  const storedOpenNet = openRows.reduce(
    (sum, r) => sum + (Number(r.net_pay) || 0),
    0,
  );
  const liveOpenNetBefore = liveMerged
    .filter((e) => String(e.payroll_month).slice(0, 10) === openPayrollMonth)
    .reduce((sum, e) => sum + (Number(e.net_pay) || 0), 0);

  console.log(
    `Open ${MONTH_LABELS[openMonth - 1]} net totals: storedPP=${roundCurrency(storedOpenNet)} liveMerged=${roundCurrency(liveOpenNetBefore)}`,
  );

  const originalAmount = Number(policyEmp.bumpTarget.amount) || 0;
  try {
    const { error: updErr } = await admin
      .from("compensation_policy")
      .update({ amount: originalAmount + BUMP })
      .eq("id", policyEmp.bumpTarget.id);
    assert(!updErr, updErr?.message ?? "policy bump failed");

    const liveAfter = await fetchPayrollLiveRecalcBundle(admin, {
      tenantId: DAVORS,
    });
    assert(!liveAfter.error, liveAfter.error ?? "live after failed");

    const liveMergedAfter = mergePayrollWagesWithLiveOpenMonths(
      history ?? [],
      processing ?? [],
      liveAfter.employees,
      liveAfter.liveContext,
    );

    const empEntryBefore = liveMerged.find(
      (e) =>
        String(e.payroll_month).slice(0, 10) === openPayrollMonth &&
        // entries are per-row without employee_id — compare via expected calc
        false,
    );
    void empEntryBefore;

    const expectedAfter = calculatePayrollRow(
      {
        employee_id: policyEmp.emp.employee_id,
        staff_id: policyEmp.emp.staff_id,
        full_name: policyEmp.emp.full_name,
        employment_type: policyEmp.emp.employment_type,
        employment_status: policyEmp.emp.employment_status ?? null,
        date_hired: policyEmp.emp.date_hired ?? null,
        appointment_end_date: policyEmp.emp.appointment_end_date ?? null,
        position: policyEmp.emp.position ?? null,
        shift: policyEmp.emp.shift ?? null,
        basic_salary: policyEmp.emp.basic_salary ?? null,
        housing_allowance: policyEmp.emp.housing_allowance ?? null,
        transport_allowance: policyEmp.emp.transport_allowance ?? null,
        other_allowances: policyEmp.emp.other_allowances ?? null,
        department: policyEmp.emp.department ?? null,
        contract_project: policyEmp.emp.contract_project,
      },
      openPeriod,
      liveAfter.liveContext.taxConfigs,
      {
        absenceCount: countAbsencesForStaff(
          liveAfter.liveContext.attendance,
          policyEmp.emp.staff_id,
          YEAR,
          openMonth,
        ),
        overtimeAmount: sumOvertimeForEmployee(
          liveAfter.liveContext.overtime,
          policyEmp.emp.employee_id,
          YEAR,
          openMonth,
        ),
        loanRepayment: calculateLoanRepaymentForEmployee(
          liveAfter.liveContext.loans,
          policyEmp.emp.employee_id,
        ),
      },
      buildManualInputsFromRow(policyEmp.row, openPeriod.totalWorkingDays),
      resolvePayrollPolicyCompensation(
        {
          employee_id: policyEmp.emp.employee_id,
          staff_id: policyEmp.emp.staff_id,
          full_name: policyEmp.emp.full_name,
          employment_type: policyEmp.emp.employment_type,
          employment_status: policyEmp.emp.employment_status ?? null,
          date_hired: policyEmp.emp.date_hired ?? null,
          appointment_end_date: policyEmp.emp.appointment_end_date ?? null,
          position: policyEmp.emp.position ?? null,
          shift: policyEmp.emp.shift ?? null,
          basic_salary: policyEmp.emp.basic_salary ?? null,
          housing_allowance: policyEmp.emp.housing_allowance ?? null,
          transport_allowance: policyEmp.emp.transport_allowance ?? null,
          other_allowances: policyEmp.emp.other_allowances ?? null,
          department: policyEmp.emp.department ?? null,
          contract_project: policyEmp.emp.contract_project,
        },
        liveAfter.liveContext.compensationPolicyConfig,
        new Date(periodEnd),
      ),
    );

    // Recompute only this employee's live entry and compare against expected.
    const liveOpenEntriesAfter = liveMergedAfter.filter(
      (e) => String(e.payroll_month).slice(0, 10) === openPayrollMonth,
    );
    const liveOpenNetAfter = liveOpenEntriesAfter.reduce(
      (sum, e) => sum + (Number(e.net_pay) || 0),
      0,
    );
    assert(
      !almostEqual(liveOpenNetAfter, liveOpenNetBefore) ||
        !almostEqual(expectedAfter.net_pay, Number(policyEmp.row.net_pay) || 0),
      "Expected live open-month nets to move after policy bump (or differ from stored)",
    );

    // Stronger: sum of live entries for open month should equal sum of per-employee live calcs
    let expectedOpenSum = 0;
    for (const row of openRows) {
      const emp = liveAfter.employees.find(
        (e) => e.employee_id === row.employee_id,
      );
      if (!emp) {
        expectedOpenSum += Number(row.net_pay) || 0;
        continue;
      }
      const source = {
        employee_id: emp.employee_id,
        staff_id: emp.staff_id,
        full_name: emp.full_name,
        employment_type: emp.employment_type,
        employment_status: emp.employment_status ?? null,
        date_hired: emp.date_hired ?? null,
        appointment_end_date: emp.appointment_end_date ?? null,
        position: emp.position ?? null,
        shift: emp.shift ?? null,
        basic_salary: emp.basic_salary ?? null,
        housing_allowance: emp.housing_allowance ?? null,
        transport_allowance: emp.transport_allowance ?? null,
        other_allowances: emp.other_allowances ?? null,
        department: emp.department ?? null,
        contract_project: emp.contract_project,
      };
      const calc = calculatePayrollRow(
        source,
        openPeriod,
        liveAfter.liveContext.taxConfigs,
        {
          absenceCount: countAbsencesForStaff(
            liveAfter.liveContext.attendance,
            emp.staff_id,
            YEAR,
            openMonth,
          ),
          overtimeAmount: sumOvertimeForEmployee(
            liveAfter.liveContext.overtime,
            emp.employee_id,
            YEAR,
            openMonth,
          ),
          loanRepayment: calculateLoanRepaymentForEmployee(
            liveAfter.liveContext.loans,
            emp.employee_id,
          ),
        },
        buildManualInputsFromRow(row, openPeriod.totalWorkingDays),
        resolvePayrollPolicyCompensation(
          source,
          liveAfter.liveContext.compensationPolicyConfig,
          new Date(periodEnd),
        ),
      );
      expectedOpenSum += calc.net_pay;
    }
    console.log(
      `Open-month live net after bump: merged=${roundCurrency(liveOpenNetAfter)} expectedSum=${roundCurrency(expectedOpenSum)} policyEmpLive=${expectedAfter.net_pay} storedPP=${policyEmp.row.net_pay}`,
    );
    assert(
      almostEqual(liveOpenNetAfter, expectedOpenSum),
      "Live merge open-month total must match batch calculatePayrollRow sum",
    );
    assert(
      !almostEqual(expectedAfter.net_pay, Number(policyEmp.row.net_pay) || 0),
      "Policy bump must change this employee's live net vs stale stored PP",
    );
    console.log(
      `PASS open-month live Accrued Wages nets track Salary Settings (${policyEmp.emp.staff_id})`,
    );

    // Accrued Wages for locked month still unchanged after bump.
    const accruedAfter = calculateAccruedWagesPayableByMonth(
      liveMergedAfter,
      expenses ?? [],
      YEAR,
      closes ?? [],
    );
    assert(
      almostEqual(accruedAfter[lockedIdx], accruedStored[lockedIdx]),
      "Locked Accrued Wages must stay frozen after open-month policy bump",
    );
    console.log("PASS locked Accrued Wages still frozen after policy bump");

    // --- BS/CF cash parity + BS balance for all 12 months (post live merge) ---
    const inventoryConfig = invConfig
      ? {
          go_live_date: invConfig.go_live_date,
          opening_inventory_value: Number(invConfig.opening_inventory_value) || 0,
          created_at: invConfig.created_at,
        }
      : null;

    const cashFlowExpenses = (expenses ?? []).map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category ?? "",
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
      notes: entry.notes ?? null,
    }));

    const bsReport = buildBalanceSheetReport(
      income ?? [],
      expenses ?? [],
      fixedAssets ?? [],
      payables ?? [],
      capital ?? [],
      cashFlowExpenses,
      liveMergedAfter,
      closes ?? [],
      YEAR,
      {
        config: inventoryConfig,
        rawMaterials: [],
        finishedProducts: [],
        finishedProductAverageCosts: [],
        cashPurchases: rawPurchases ?? [],
        productCashPurchases: productPurchases ?? [],
      },
      manual ?? [],
      taxLedger ?? [],
    );

    const cfReport = buildCashFlowReport(
      (income ?? []).map((e) => ({
        date: e.date,
        amount_received: e.amount_received,
        entry_type: e.entry_type,
        sale_status: e.sale_status,
      })),
      cashFlowExpenses,
      manual ?? [],
      YEAR,
      {
        rawMaterialCashPurchases: rawPurchases ?? [],
        productCashPurchases: productPurchases ?? [],
        inventoryConfig,
      },
      fixedAssets ?? [],
      capital ?? [],
      undefined,
      payables ?? [],
    );

    const bsCash = bsReport.rows.find((r) => r.key === "cash")?.amounts;
    const cfClosing = cfReport.rows.find(
      (r) => r.key === "closing-cash-balance",
    )?.amounts;
    assert(bsCash && cfClosing, "Missing cash rows");

    const cashMismatches = [];
    const balanceFails = [];
    for (let i = 0; i < 12; i += 1) {
      const bs = roundCurrency(bsCash[i] ?? 0);
      const cf = roundCurrency(cfClosing[i] ?? 0);
      const match = almostEqual(bs, cf, 0.01);
      console.log(
        `  ${MONTH_LABELS[i]} cash BS=${bs.toFixed(2)} CF=${cf.toFixed(2)} ${match ? "OK" : "MISMATCH"}`,
      );
      if (!match) {
        cashMismatches.push({
          month: MONTH_LABELS[i],
          bs,
          cf,
          delta: roundCurrency(bs - cf),
        });
      }

      const check = getBalanceCheckForPeriod(bsReport, i);
      console.log(
        `  ${MONTH_LABELS[i]} balance A=${check.totalAssets.toFixed(2)} L+E=${check.totalLiabilitiesAndEquity.toFixed(2)} diff=${check.difference.toFixed(2)} ${check.isBalanced ? "OK" : "FAIL"}`,
      );
      if (!check.isBalanced) {
        balanceFails.push({
          month: MONTH_LABELS[i],
          difference: check.difference,
        });
      }
    }

    assert(
      cashMismatches.length === 0,
      `BS/CF cash parity failed: ${JSON.stringify(cashMismatches)}`,
    );
    console.log("PASS BS cash === CF closing cash for all 12 FY2026 months");

    assert(
      balanceFails.length === 0,
      `BS does not balance: ${JSON.stringify(balanceFails)}`,
    );
    console.log("PASS Assets = Liabilities + Equity for all 12 months");
  } finally {
    await admin
      .from("compensation_policy")
      .update({ amount: originalAmount })
      .eq("id", policyEmp.bumpTarget.id);
  }

  console.log("\nALL CHECKS PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
