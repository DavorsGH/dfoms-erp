/**
 * Fix August 2026 corrupted partial-lock desync on Davors staging.
 *
 * Phase A: unstick (delete stale finance, MEC -> Open, keep processing)
 * Phase B: partial re-lock via same writers as lock-period API
 * Phase C: verify BS + payroll/finance alignment; July/Sep untouched
 *
 *   npx tsx scripts/fix-august-2026-payroll-lock-desync-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { promoteAllowanceLinesToHistory } from "../app/dashboard/hr-payroll/payroll-allowance-lines-utils";
import {
  applyEmployeeIdScope,
  filterPayrollRowsToEmployeeScope,
  resolvePayrollPeriodScopedEmployeeIds,
} from "../app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  calculatePayrollLockFinanceTotals,
  deletePayrollLockFinanceEntries,
  postPayrollLockFinanceEntries,
  resolvePayrollLockFinancePeriod,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  PAYROLL_STATUS_OPEN,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
} from "../app/dashboard/hr-payroll/payroll-period-utils";
import {
  processingRowToHistoryPayload,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import { buildPayrollPeriodTaxLedgerSourceId } from "../app/dashboard/hr-payroll/payroll-statutory-ledger-sync";
import { MONTH_END_CLOSE_ON_CONFLICT } from "../utils/phase5e-key-structure";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PAYROLL_MONTH = "2026-08-01";
const PERIOD_YEAR = 2026;
const PERIOD_MONTH = 8;
const AUG_INDEX = 7;
const FY = 2026;
const SAL_RECEIPT = "PAYROLL-SAL-2026-08";
const JULY_MONTH = "2026-07-01";
const SEPT_MONTH = "2026-09-01";
const PARTIAL_LOCK_NOTES = "test";

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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function log(section: string, detail: unknown) {
  console.log(`\n=== ${section} ===`);
  if (typeof detail === "string") {
    console.log(detail);
  } else {
    console.log(JSON.stringify(detail, null, 2));
  }
}

async function fetchAugustBsDiff(admin: ReturnType<typeof createClient>) {
  const data = await fetchBalanceSheetPageData(admin, DAVORS);
  const report = buildBalanceSheetReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    data.initialPayableEntries,
    data.initialCapitalContributions,
    data.initialCashFlowExpenseEntries,
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
    FY,
    data.initialInventoryBalanceSheet,
    data.initialManualEntries,
    data.initialTaxLedgerEntries,
    {
      tenantId: DAVORS,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  const check = getBalanceCheckForPeriod(report, AUG_INDEX);
  return {
    difference: r2(check.difference),
    isBalanced: check.isBalanced,
    totalAssets: r2(check.totalAssets),
    totalLiabilitiesAndEquity: r2(check.totalLiabilitiesAndEquity),
  };
}

async function snapshotContext(admin: ReturnType<typeof createClient>) {
  const payrollSourceId = buildPayrollPeriodTaxLedgerSourceId(PAYROLL_MONTH);
  const [
    { count: historyCount },
    { count: processingCount },
    { data: salExpense },
    { data: taxLegs },
    { data: julyMec },
    { data: septMec },
    { data: augMec },
  ] = await Promise.all([
    admin
      .from("payroll_history")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", PAYROLL_MONTH),
    admin
      .from("payroll_processing")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", PAYROLL_MONTH),
    admin
      .from("expense_register")
      .select("amount, payment_status, description")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", SAL_RECEIPT)
      .maybeSingle(),
    admin
      .from("tax_ledger_entries")
      .select("tax_component, tax_amount, status")
      .eq("tenant_id", DAVORS)
      .eq("source_id", payrollSourceId)
      .neq("status", "reversed"),
    admin
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("month", JULY_MONTH)
      .maybeSingle(),
    admin
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("month", SEPT_MONTH)
      .maybeSingle(),
    admin
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("month", PAYROLL_MONTH)
      .maybeSingle(),
  ]);

  const taxByComponent = Object.fromEntries(
    (taxLegs ?? []).map((row) => [row.tax_component, r2(Number(row.tax_amount) || 0)]),
  );
  const ssnitTotal = r2(
    (Number(taxByComponent.ssnit_employee) || 0) +
      (Number(taxByComponent.ssnit_employer_tier1) || 0) +
      (Number(taxByComponent.ssnit_tier2) || 0),
  );

  return {
    historyCount: historyCount ?? 0,
    processingCount: processingCount ?? 0,
    staffSalaries: salExpense ? r2(Number(salExpense.amount) || 0) : null,
    staffSalariesStatus: salExpense?.payment_status ?? null,
    paye: r2(Number(taxByComponent.paye) || 0),
    ssnitTotal,
    taxLegs: taxLegs ?? [],
    julyMec,
    septMec,
    augMec,
  };
}

async function main() {
  const envFile = ".env.staging.local";
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);
  assert(!!key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const businessUnitId = null;
  const financePeriod = resolvePayrollLockFinancePeriod(
    PAYROLL_MONTH,
    PERIOD_YEAR,
    PERIOD_MONTH,
  );
  assert(!!financePeriod, "Unable to resolve finance period");

  const beforeBs = await fetchAugustBsDiff(admin);
  const beforeCtx = await snapshotContext(admin);
  const julyBefore = JSON.stringify(beforeCtx.julyMec);
  const septBefore = JSON.stringify(beforeCtx.septMec);

  log("BEFORE", {
    balanceSheetAugust: beforeBs,
    augustSnapshot: {
      mec: beforeCtx.augMec,
      historyCount: beforeCtx.historyCount,
      processingCount: beforeCtx.processingCount,
      staffSalaries: beforeCtx.staffSalaries,
      paye: beforeCtx.paye,
      ssnitTotal: beforeCtx.ssnitTotal,
    },
    julyMec: beforeCtx.julyMec,
    septemberMec: beforeCtx.septMec,
  });

  // --- Phase A: Unstick ---
  const { data: processingRows, error: processingFetchError } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", PAYROLL_MONTH)
    .order("employee_id", { ascending: true });

  if (processingFetchError) {
    throw new Error(processingFetchError.message);
  }

  const rows = processingRows ?? [];
  assert(rows.length === 21, `Expected 21 processing rows, got ${rows.length}`);

  const financeDelete = await deletePayrollLockFinanceEntries(
    admin,
    financePeriod!,
    DAVORS,
    {
      businessUnitId,
      loanRepaymentRows: rows.map((row) => ({
        employee_id: row.employee_id,
        loan_repayment: row.loan_repayment,
      })),
    },
  );

  const { data: openedMec, error: openError } = await admin
    .from("month_end_close")
    .upsert(
      {
        tenant_id: DAVORS,
        month: PAYROLL_MONTH,
        business_unit_id: businessUnitId,
        employees_recorded: rows.length,
        total_net_pay: r2(
          rows.reduce((sum, row) => sum + (Number(row.net_pay) || 0), 0),
        ),
        lock_status: PAYROLL_STATUS_OPEN,
        notes: null,
      },
      { onConflict: MONTH_END_CLOSE_ON_CONFLICT },
    )
    .select("*")
    .single();

  if (openError) {
    throw new Error(`Phase A MEC open failed: ${openError.message}`);
  }

  const { count: processingAfterUnstick } = await admin
    .from("payroll_processing")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", PAYROLL_MONTH);

  log("PHASE A — Unstick complete", {
    processingRowsLoaded: rows.length,
    deletePayrollLockFinanceEntries: financeDelete,
    monthEndClose: openedMec,
    payrollProcessingPreserved: processingAfterUnstick,
  });

  // --- Phase B: Partial re-lock (lock-period writers) ---
  const scopedEmployees = await resolvePayrollPeriodScopedEmployeeIds(
    admin,
    DAVORS,
    businessUnitId,
  );
  assert(scopedEmployees.ok, scopedEmployees.error ?? "employee scope failed");
  const { employeeIds } = scopedEmployees;

  const scopedRowsResult = filterPayrollRowsToEmployeeScope(
    rows,
    employeeIds,
    "No payroll rows to lock for this period",
  );
  assert(scopedRowsResult.ok, scopedRowsResult.error ?? "scope filter failed");
  const scopedRows = scopedRowsResult.rows;
  assert(scopedRows.length === 21, `Scoped rows=${scopedRows.length}, expected 21`);

  const totalNetPay = scopedRows.reduce(
    (sum, row) => sum + (Number(row.net_pay) || 0),
    0,
  );

  const historyRows = scopedRows.map((row) => ({
    ...processingRowToHistoryPayload(row, PAYROLL_MONTH, false, null),
    tenant_id: DAVORS,
  }));

  const { error: historyInsertError } = await admin
    .from("payroll_history")
    .insert(historyRows);
  if (historyInsertError) {
    throw new Error(`Phase B history insert failed: ${historyInsertError.message}`);
  }

  const { error: processingDeleteError } = await applyEmployeeIdScope(
    admin
      .from("payroll_processing")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", PAYROLL_MONTH),
    employeeIds,
  );
  if (processingDeleteError) {
    throw new Error(
      `Phase B processing delete failed: ${processingDeleteError.message}`,
    );
  }

  const allowancePromote = await promoteAllowanceLinesToHistory(
    admin,
    DAVORS,
    PAYROLL_MONTH,
    { fallbackBusinessUnitId: businessUnitId },
  );
  if (allowancePromote.error) {
    throw new Error(`Phase B allowance promote failed: ${allowancePromote.error}`);
  }

  const { data: lockedMec, error: lockMecError } = await admin
    .from("month_end_close")
    .upsert(
      {
        tenant_id: DAVORS,
        month: PAYROLL_MONTH,
        business_unit_id: businessUnitId,
        employees_recorded: historyRows.length,
        total_net_pay: r2(totalNetPay),
        lock_status: PAYROLL_STATUS_PARTIALLY_LOCKED,
        notes: PARTIAL_LOCK_NOTES,
      },
      { onConflict: MONTH_END_CLOSE_ON_CONFLICT },
    )
    .select("*")
    .single();

  if (lockMecError) {
    throw new Error(`Phase B MEC lock failed: ${lockMecError.message}`);
  }

  const financePost = await postPayrollLockFinanceEntries(
    admin,
    financePeriod!,
    scopedRows,
    DAVORS,
    {
      markStaffSalariesPaid: false,
      businessUnitId,
    },
  );

  const expectedTotals = calculatePayrollLockFinanceTotals(scopedRows);

  log("PHASE B — Partial re-lock complete", {
    historyInserted: historyRows.length,
    monthEndClose: lockedMec,
    financePost,
    expectedTotals,
  });

  // --- Phase C: Verify ---
  const afterBs = await fetchAugustBsDiff(admin);
  const afterCtx = await snapshotContext(admin);

  const checks = {
    augustBsBalanced: afterBs.isBalanced && afterBs.difference === 0,
    augustBsDiff: afterBs.difference,
    historyCount: afterCtx.historyCount === 21,
    processingCount: afterCtx.processingCount === 0,
    staffSalaries: afterCtx.staffSalaries === 15418.9,
    paye: afterCtx.paye === 869.65,
    ssnitTotal: afterCtx.ssnitTotal === 804.75,
    julyUnchanged: JSON.stringify(afterCtx.julyMec) === julyBefore,
    septemberUnchanged: JSON.stringify(afterCtx.septMec) === septBefore,
  };

  log("PHASE C — Verification", {
    balanceSheetAugust: afterBs,
    augustSnapshot: {
      mec: afterCtx.augMec,
      historyCount: afterCtx.historyCount,
      processingCount: afterCtx.processingCount,
      staffSalaries: afterCtx.staffSalaries,
      staffSalariesStatus: afterCtx.staffSalariesStatus,
      paye: afterCtx.paye,
      ssnitTotal: afterCtx.ssnitTotal,
      taxLegs: afterCtx.taxLegs,
    },
    julyMec: afterCtx.julyMec,
    septemberMec: afterCtx.septMec,
    checks,
  });

  const allPassed = Object.values(checks).every(Boolean);
  if (!allPassed) {
    // Diagnose residual BS gap when payroll writers are aligned.
    const { data: augExpenses } = await admin
      .from("expense_register")
      .select("receipt_no, expense_category, amount, payment_status, description")
      .eq("tenant_id", DAVORS)
      .ilike("description", "%Auto-posted from Payroll August 2026%");
    const { data: augHistory } = await admin
      .from("payroll_history")
      .select(
        "loan_repayment, net_only_adjustment, absence_deduction, salary_advance, welfare_deduction, other_deductions",
      )
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", PAYROLL_MONTH);

    log("RESIDUAL BS GAP DIAGNOSTIC (+8)", {
      augustAutoExpenses: augExpenses,
      historyDeductions: {
        loan_repayment: r2(
          (augHistory ?? []).reduce(
            (s, r) => s + (Number(r.loan_repayment) || 0),
            0,
          ),
        ),
        net_only_adjustment: r2(
          (augHistory ?? []).reduce(
            (s, r) => s + (Number(r.net_only_adjustment) || 0),
            0,
          ),
        ),
        absence_deduction: r2(
          (augHistory ?? []).reduce(
            (s, r) => s + (Number(r.absence_deduction) || 0),
            0,
          ),
        ),
      },
    });

    throw new Error(`Verification failed: ${JSON.stringify(checks)}`);
  }

  console.log("\nSUCCESS: August 2026 payroll desync fixed on staging.");
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
