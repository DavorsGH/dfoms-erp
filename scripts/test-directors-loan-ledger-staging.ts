/**
 * Staging: Director's Loan ledger — four entry types, BS + cash, reverse cleanup.
 *
 *   npx tsx scripts/test-directors-loan-ledger-staging.ts
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
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import { buildNetPayByPayrollMonth } from "../app/dashboard/finance/accrued-wages-utils";
import { buildProfitLossReport } from "../app/dashboard/finance/profit-loss-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const MONTH_INDEX = 7;
const ENTRY_DATE = "2026-08-20";
const TOL = 0.05;

const createdEntryIds: string[] = [];
const createdExpenseIds: string[] = [];

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function near(a: number, b: number) {
  return Math.abs(a - b) <= TOL;
}

function rowAmt(report, key, mi = MONTH_INDEX) {
  return report.rows.find((r) => r.key === key)?.amounts[mi] ?? 0;
}

function cfAmt(reports, key, mi = MONTH_INDEX) {
  return rowAmt(reports.cf, key, mi);
}

async function loadReports(admin) {
  const data = await fetchBalanceSheetPageData(admin, TENANT, {
    viewAllBusinessUnits: false,
    activeBusinessUnitId: null,
  });
  const ledger = (data.initialDirectorsLoanLedgerEntries ?? []).filter(
    (e) => !e.reversed_at,
  );
  const staffSalary = buildNetPayByPayrollMonth(
    data.initialPayrollHistory,
    data.initialMonthEndCloseNetPay,
  );
  const bsOpts = {
    tenantId: TENANT,
    accountsPayablePayments: data.initialAccountsPayablePayments,
    directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    directorsLoanLedgerEntries: ledger,
  };
  const manual = data.initialManualEntries.filter((m) =>
    String(m.period_month).startsWith(String(FY)),
  );
  const bs = buildBalanceSheetReport(
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
    manual,
    data.initialTaxLedgerEntries,
    data.initialWelfareFundEntries,
    bsOpts,
  );
  const cf = buildCashFlowReport(
    data.initialCashFlowIncomeEntries,
    data.initialCashFlowExpenseEntries,
    manual,
    FY,
    {
      rawMaterialCashPurchases: data.initialInventoryBalanceSheet.cashPurchases ?? [],
      productCashPurchases: data.initialInventoryBalanceSheet.productCashPurchases ?? [],
      inventoryConfig: data.initialInventoryBalanceSheet.config,
    },
    data.initialFixedAssets,
    data.initialCapitalContributions,
    staffSalary,
    data.initialPayableEntries,
    bsOpts,
  );
  const pl = buildProfitLossReport(
    data.initialIncomeEntries,
    data.initialExpenseEntries,
    data.initialFixedAssets,
    FY,
  );
  return { bs, cf, pl, data };
}

function snap(reports) {
  const { bs, cf, pl } = reports;
  return {
    cash: rowAmt(bs, "cash"),
    directorsLoan: rowAmt(bs, "directors-loan"),
    dueFromDirector: rowAmt(bs, "due-from-director"),
    bsDiff: getBalanceCheckForPeriod(bs, MONTH_INDEX).difference,
    bsBalanced: getBalanceCheckForPeriod(bs, MONTH_INDEX).isBalanced,
    netCash: rowAmt(cf, "net-movement"),
    netProfit: rowAmt(pl, "net-profit"),
  };
}

async function insertEntry(admin, payload) {
  const { data, error } = await admin
    .from("directors_loan_entries")
    .insert({ tenant_id: TENANT, business_unit_id: null, ...payload })
    .select("id")
    .single();
  assert(!error, error?.message ?? "insert failed");
  createdEntryIds.push(data.id);
  return data.id;
}

async function reverseEntry(admin, id, reason = "Staging test cleanup reverse") {
  const { error } = await admin
    .from("directors_loan_entries")
    .update({
      reversed_at: new Date().toISOString(),
      reversal_reason: reason,
    })
    .eq("id", id)
    .eq("tenant_id", TENANT);
  assert(!error, error?.message ?? "reverse failed");
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), "Refusing: not staging");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const baseline = snap(await loadReports(admin));
  console.log("Baseline Aug 2026 (default BU):", baseline);

  try {
    const reportsBeforeLent = await loadReports(admin);
    const beforeLent = snap(reportsBeforeLent);
    await insertEntry(admin, {
      entry_date: ENTRY_DATE,
      entry_type: "director_lent_company",
      amount: 500,
      description: "DL test lent",
      reference: "staging-ledger-test",
    });
    const reportsAfterLent = await loadReports(admin);
    const afterLent = snap(reportsAfterLent);
    assert(
      near(afterLent.directorsLoan - beforeLent.directorsLoan, 500),
      `director_lent liability (got ${afterLent.directorsLoan - beforeLent.directorsLoan})`,
    );
    assert(
      near(
        cfAmt(reportsAfterLent, "directors-loan-inflows") -
          cfAmt(reportsBeforeLent, "directors-loan-inflows"),
        500,
      ),
      "director_lent CF inflow",
    );
    const reportsBeforeRepaid = await loadReports(admin);
    const beforeRepaid = snap(reportsBeforeRepaid);
    await insertEntry(admin, {
      entry_date: ENTRY_DATE,
      entry_type: "company_repaid_director",
      amount: 200,
      description: "DL test repaid",
      reference: "staging-ledger-test",
    });
    const reportsAfterRepaid = await loadReports(admin);
    const afterRepaid = snap(reportsAfterRepaid);
    assert(
      near(
        cfAmt(reportsAfterRepaid, "directors-loan-repayments") -
          cfAmt(reportsBeforeRepaid, "directors-loan-repayments"),
        200,
      ),
      "company_repaid CF out",
    );
    assert(
      near(beforeRepaid.directorsLoan - afterRepaid.directorsLoan, 200),
      "company_repaid reduces liability",
    );

    const reportsBeforePaid = await loadReports(admin);
    const beforePaid = snap(reportsBeforePaid);
    await insertEntry(admin, {
      entry_date: ENTRY_DATE,
      entry_type: "company_paid_for_director",
      amount: 2000,
      description: "DL test paid for director",
      reference: "staging-ledger-test",
    });
    const reportsAfterPaid = await loadReports(admin);
    const afterPaid = snap(reportsAfterPaid);
    assert(
      near(
        cfAmt(reportsAfterPaid, "directors-loan-repayments") -
          cfAmt(reportsBeforePaid, "directors-loan-repayments"),
        2000,
      ),
      "company_paid CF out",
    );
    assert(
      afterPaid.dueFromDirector > beforePaid.dueFromDirector,
      "company_paid increases Due from Director (net owed by director)",
    );

    const reportsBeforeDirRepaid = await loadReports(admin);
    const beforeDirRepaid = snap(reportsBeforeDirRepaid);
    await insertEntry(admin, {
      entry_date: ENTRY_DATE,
      entry_type: "director_repaid_company",
      amount: 150,
      description: "DL test director repaid",
      reference: "staging-ledger-test",
    });
    const reportsAfterDirRepaid = await loadReports(admin);
    const afterDirRepaid = snap(reportsAfterDirRepaid);
    assert(
      near(
        cfAmt(reportsAfterDirRepaid, "directors-loan-inflows") -
          cfAmt(reportsBeforeDirRepaid, "directors-loan-inflows"),
        150,
      ),
      "director_repaid CF in",
    );
    assert(
      afterDirRepaid.dueFromDirector < beforeDirRepaid.dueFromDirector,
      "director_repaid reduces Due from Director",
    );

    const { data: expense, error: expErr } = await admin
      .from("expense_register")
      .insert({
        tenant_id: TENANT,
        business_unit_id: null,
        date: ENTRY_DATE,
        expense_category: "Other",
        sub_category: "Miscellaneous",
        description: "DL ledger linked expense test",
        amount: 75,
        payment_status: "paid",
        receipt_no: `DL-TST-${Date.now()}`,
      })
      .select("id")
      .single();
    assert(!expErr, expErr?.message ?? "expense insert");
    createdExpenseIds.push(expense.id);

    const reportsWithExpense = await loadReports(admin);
    const plWithExpense = rowAmt(reportsWithExpense.pl, "net-profit");
    const cashWithExpense = rowAmt(reportsWithExpense.bs, "cash");
    await insertEntry(admin, {
      entry_date: ENTRY_DATE,
      entry_type: "company_paid_for_director",
      amount: 75,
      description: "DL test linked remove expense",
      reference: "staging-ledger-test",
      linked_expense_id: expense.id,
    });
    await admin.from("expense_register").delete().eq("id", expense.id);
    createdExpenseIds.pop();
    const { data: expAfter } = await admin
      .from("expense_register")
      .select("id")
      .eq("id", expense.id)
      .maybeSingle();
    assert(!expAfter, "linked expense should be removed from register");
    const reportsAfterLink = await loadReports(admin);
    const plAfter = rowAmt(reportsAfterLink.pl, "net-profit");
    const cashAfterLink = rowAmt(reportsAfterLink.bs, "cash");
    assert(plAfter > plWithExpense, "P&L net should improve when expense row removed");
    assert(near(cashWithExpense, cashAfterLink), "cash unchanged overall after linked reclass");

    const editId = createdEntryIds[0];
    const { error: updErr } = await admin
      .from("directors_loan_entries")
      .update({ amount: 550, description: "DL test lent edited" })
      .eq("id", editId);
    assert(!updErr, updErr?.message ?? "update");
    const afterEdit = snap(await loadReports(admin));

    await reverseEntry(admin, editId);
    const afterReverseOne = snap(await loadReports(admin));

    console.log("PASS — all four entry types, edit, linked expense, BS checks");
  } finally {
    for (const id of [...createdEntryIds].reverse()) {
      await admin
        .from("directors_loan_entries")
        .delete()
        .eq("id", id)
        .eq("tenant_id", TENANT);
    }
    for (const id of createdExpenseIds) {
      await admin.from("expense_register").delete().eq("id", id);
    }
    const end = snap(await loadReports(admin));
    assert(near(end.cash, baseline.cash), "cleanup: cash restored");
    assert(near(end.directorsLoan, baseline.directorsLoan), "cleanup: DL restored");
    assert(near(end.dueFromDirector, baseline.dueFromDirector), "cleanup: due from director restored");
    console.log("Cleanup restored baseline:", end);
  }
}

main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
