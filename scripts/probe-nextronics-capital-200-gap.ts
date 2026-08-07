/**
 * Read-only: Nextronics Aug 2026 GHS 200 BS gap — Capital Contributions framework.
 * Run: npx tsx scripts/probe-nextronics-capital-200-gap.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import { isCashOutflowExpense } from "../app/dashboard/finance/accrued-wages-utils";
import { getEntryMonthIndex } from "../app/dashboard/finance/profit-loss-utils";

const PROD_REF = "tvcurcnmasnocwdxzgvz";
const FY = 2026;
const AUGUST_INDEX = 7; // 0-based

const PNL_SECTION_CATEGORIES = [
  "Cost of Goods Sold",
  "Direct Operational",
  "Administrative",
  "Marketing",
  "Finance",
  "Staff Salaries",
  "Employer SSNIT Contribution",
  "Other",
];

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function rowAmount(
  report: { rows: Array<{ key: string; amounts: number[] }> },
  key: string,
  monthIndex: number,
) {
  return report.rows.find((r) => r.key === key)?.amounts[monthIndex] ?? 0;
}

function isPnlRecognizedCategory(category: string | null | undefined): boolean {
  const normalized = (category ?? "").trim().toLowerCase();
  return PNL_SECTION_CATEGORIES.some(
    (c) => c.toLowerCase() === normalized,
  );
}

function isAugust2026(date: string | null | undefined): boolean {
  if (!date) return false;
  const part = date.slice(0, 10);
  return part.startsWith("2026-08");
}

function fyForDate(date: string | null | undefined): number | null {
  if (!date) return null;
  const m = /^(\d{4})-\d{2}-\d{2}/.exec(date.slice(0, 10));
  return m ? Number(m[1]) : null;
}

async function fetchPayrollHistory(admin, tenantId: string) {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!preferred.error) return preferred.data ?? [];
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []).map((row) => ({
    payroll_month: row.payroll_month,
    net_pay: row.net_pay,
    net_only_adjustment: 0,
  }));
}

async function buildBsSnapshot(
  admin,
  tenantId: string,
  opts: {
    excludeExpenseIds?: string[];
    excludeCapitalIds?: string[];
  } = {},
) {
  const excludeExp = new Set(opts.excludeExpenseIds ?? []);
  const excludeCap = new Set(opts.excludeCapitalIds ?? []);

  const [
    { data: income },
    { data: expenses },
    { data: fixedAssets },
    { data: payables },
    { data: capital },
    { data: manual },
    { data: payrollProcessing },
    { data: monthEndClose },
    { data: taxLedger },
    inventoryInput,
    livePayrollBundle,
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", tenantId),
    admin.from("expense_register").select("*").eq("tenant_id", tenantId),
    admin.from("fixed_assets").select("*").eq("tenant_id", tenantId),
    admin.from("accounts_payable").select("*").eq("tenant_id", tenantId),
    admin.from("capital_contributions").select("*").eq("tenant_id", tenantId),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", tenantId),
    admin.from("payroll_processing").select("*").eq("tenant_id", tenantId),
    admin.from("month_end_close").select("*").eq("tenant_id", tenantId),
    admin
      .from("tax_ledger_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
    fetchInventoryBalanceSheetInput(admin, tenantId),
    fetchPayrollLiveRecalcBundle(admin, { tenantId }),
  ]);

  const payrollHistory = await fetchPayrollHistory(admin, tenantId);
  const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory,
    payrollProcessing ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  const filteredExpenses = (expenses ?? []).filter((e) => !excludeExp.has(e.id));
  const filteredCapital = (capital ?? []).filter((c) => !excludeCap.has(c.id));

  const cashFlowExpenses = filteredExpenses.map((e) => ({
    date: e.date,
    expense_category: e.expense_category ?? "",
    sub_category: e.sub_category,
    amount: e.amount,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  const report = buildBalanceSheetReport(
    income ?? [],
    filteredExpenses,
    fixedAssets ?? [],
    payables ?? [],
    filteredCapital,
    cashFlowExpenses,
    payrollMerged,
    monthEndClose ?? [],
    FY,
    inventoryInput,
    manual ?? [],
    taxLedger ?? [],
  );

  const check = getBalanceCheckForPeriod(report, AUGUST_INDEX);
  return {
    cash: r2(rowAmount(report, "cash", AUGUST_INDEX)),
    shareCapital: r2(rowAmount(report, "share-capital", AUGUST_INDEX)),
    retainedEarnings: r2(rowAmount(report, "retained-earnings", AUGUST_INDEX)),
    inventory: r2(rowAmount(report, "inventory", AUGUST_INDEX)),
    totalAssets: r2(check.totalAssets),
    totalLE: r2(check.totalLiabilitiesAndEquity),
    diff: r2(check.difference),
    balanced: check.isBalanced,
  };
}

async function main() {
  loadEnv(resolve(".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PROD_REF)) {
    throw new Error(`Refusing non-production URL: ${url}`);
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: tenants, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, slug")
    .or("name.ilike.%nextr%,slug.ilike.%nextr%");
  if (tenantError) throw new Error(tenantError.message);

  const tenant = tenants?.[0];
  if (!tenant) throw new Error("Nextronics tenant not found");

  console.log("=== Tenant ===");
  console.log(JSON.stringify(tenant, null, 2));

  const TENANT_ID = tenant.id;

  // 1. All August 2026 expenses ~200 or Electronics-related
  const { data: allExpenses, error: expErr } = await admin
    .from("expense_register")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .order("date", { ascending: true });
  if (expErr) throw new Error(expErr.message);

  const aug2026Expenses = (allExpenses ?? []).filter((e) => isAugust2026(e.date));
  const electronicsCandidates = (allExpenses ?? []).filter(
    (e) =>
      String(e.sub_category ?? "").toLowerCase().includes("electronic") ||
      String(e.description ?? "").toLowerCase().includes("electronic") ||
      (Number(e.amount) === 200 && isAugust2026(e.date)),
  );
  const amount200Aug = aug2026Expenses.filter((e) => r2(Number(e.amount)) === 200);

  console.log("\n=== 1. Electronics / GHS 200 August 2026 expense candidates ===");
  for (const e of electronicsCandidates) {
    const cashEntry = {
      date: e.date,
      expense_category: e.expense_category ?? "",
      sub_category: e.sub_category,
      amount: e.amount,
      payment_status: e.payment_status,
      description: e.description ?? null,
      receipt_no: e.receipt_no ?? null,
      notes: e.notes ?? null,
    };
    console.log(
      JSON.stringify(
        {
          id: e.id,
          date: e.date,
          amount: r2(Number(e.amount)),
          expense_category: e.expense_category,
          sub_category: e.sub_category,
          payment_status: e.payment_status,
          description: e.description,
          receipt_no: e.receipt_no,
          notes: e.notes,
          pnlRecognized: isPnlRecognizedCategory(e.expense_category),
          hitsCash: isCashOutflowExpense(cashEntry),
          pnlMonthIndex: getEntryMonthIndex(e.date, FY),
        },
        null,
        2,
      ),
    );
  }

  if (electronicsCandidates.length === 0) {
    console.log("(none found — listing all Aug 2026 expenses)");
    for (const e of aug2026Expenses) {
      console.log(
        JSON.stringify({
          id: e.id,
          date: e.date,
          amount: r2(Number(e.amount)),
          expense_category: e.expense_category,
          sub_category: e.sub_category,
          payment_status: e.payment_status,
        }),
      );
    }
  }

  console.log("\n=== All Aug 2026 expenses with amount exactly 200 ===");
  console.log(JSON.stringify(amount200Aug, null, 2));

  // 2. Capital contributions ~200
  const { data: allCapital, error: capErr } = await admin
    .from("capital_contributions")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .order("date", { ascending: true });
  if (capErr) throw new Error(capErr.message);

  const capital200 = (allCapital ?? []).filter(
    (c) => r2(Number(c.amount)) === 200,
  );
  const capitalAug2026 = (allCapital ?? []).filter((c) => isAugust2026(c.date));

  console.log("\n=== 2. Capital contribution entries (amount = 200) ===");
  for (const c of capital200) {
    console.log(
      JSON.stringify(
        {
          id: c.id,
          date: c.date,
          amount: r2(Number(c.amount)),
          contributed_by: c.contributed_by,
          description: c.description,
          notes: c.notes,
          financialYear: fyForDate(c.date),
          pnlMonthIndex: getEntryMonthIndex(c.date, FY),
          inAugust2026: isAugust2026(c.date),
        },
        null,
        2,
      ),
    );
  }

  console.log("\n=== All Aug 2026 capital contributions (any amount) ===");
  console.log(JSON.stringify(capitalAug2026, null, 2));

  // Identify the suspect pair
  const suspectExpense =
    electronicsCandidates.find((e) => r2(Number(e.amount)) === 200) ??
    amount200Aug[0] ??
    null;
  const suspectCapital =
    capital200.find((c) => isAugust2026(c.date)) ??
    capital200[capital200.length - 1] ??
    null;

  console.log("\n=== Suspect pair for analysis ===");
  console.log(
    JSON.stringify(
      {
        expense: suspectExpense
          ? {
              id: suspectExpense.id,
              date: suspectExpense.date,
              amount: suspectExpense.amount,
              expense_category: suspectExpense.expense_category,
              sub_category: suspectExpense.sub_category,
              payment_status: suspectExpense.payment_status,
            }
          : null,
        capital: suspectCapital
          ? {
              id: suspectCapital.id,
              date: suspectCapital.date,
              amount: suspectCapital.amount,
              description: suspectCapital.description,
            }
          : null,
      },
      null,
      2,
    ),
  );

  // 3. BS snapshots: full, without pair, without each individually
  console.log("\n=== 3. Balance Sheet August 2026 snapshots ===");
  const full = await buildBsSnapshot(admin, TENANT_ID);
  console.log("FULL (all data):", full);

  const excludeIds = {
    expenseIds: suspectExpense ? [suspectExpense.id] : [],
    capitalIds: suspectCapital ? [suspectCapital.id] : [],
  };

  const withoutPair = await buildBsSnapshot(admin, TENANT_ID, {
    excludeExpenseIds: excludeIds.expenseIds,
    excludeCapitalIds: excludeIds.capitalIds,
  });
  console.log("WITHOUT suspect pair:", withoutPair);

  const withoutExpenseOnly = await buildBsSnapshot(admin, TENANT_ID, {
    excludeExpenseIds: excludeIds.expenseIds,
  });
  console.log("WITHOUT expense only:", withoutExpenseOnly);

  const withoutCapitalOnly = await buildBsSnapshot(admin, TENANT_ID, {
    excludeCapitalIds: excludeIds.capitalIds,
  });
  console.log("WITHOUT capital only:", withoutCapitalOnly);

  console.log("\n=== Pair impact on BS diff ===");
  console.log(
    JSON.stringify(
      {
        fullDiff: full.diff,
        withoutPairDiff: withoutPair.diff,
        deltaDiffFromRemovingPair: r2(full.diff - withoutPair.diff),
        withoutExpenseDiff: withoutExpenseOnly.diff,
        withoutCapitalDiff: withoutCapitalOnly.diff,
        pairAloneWouldCauseGap: r2(full.diff - withoutPair.diff),
        preExistingGapBeforePair: withoutPair.balanced
          ? 0
          : withoutPair.diff,
      },
      null,
      2,
    ),
  );

  // Cause framework
  console.log("\n=== 4. Three-cause framework ===");
  if (suspectExpense) {
    const cashEntry = {
      date: suspectExpense.date,
      expense_category: suspectExpense.expense_category ?? "",
      sub_category: suspectExpense.sub_category,
      amount: suspectExpense.amount,
      payment_status: suspectExpense.payment_status,
      description: suspectExpense.description ?? null,
      receipt_no: suspectExpense.receipt_no ?? null,
      notes: suspectExpense.notes ?? null,
    };
    const cause2 =
      isCashOutflowExpense(cashEntry) &&
      !isPnlRecognizedCategory(suspectExpense.expense_category);
    const cause3 =
      !isCashOutflowExpense(cashEntry) && suspectCapital !== null;
    console.log(
      JSON.stringify(
        {
          cause2_unmappedPnlCategory: {
            applies: cause2,
            expense_category: suspectExpense.expense_category,
            pnlRecognized: isPnlRecognizedCategory(
              suspectExpense.expense_category,
            ),
            hitsCash: isCashOutflowExpense(cashEntry),
            payment_status: suspectExpense.payment_status,
          },
          cause3_wrongPaymentStatusPlusCapital: {
            applies: cause3,
            payment_status: suspectExpense.payment_status,
            hitsCash: isCashOutflowExpense(cashEntry),
            capitalPresent: Boolean(suspectCapital),
          },
          cause1_preExistingImbalance: {
            applies: !withoutPair.balanced,
            withoutPairDiff: withoutPair.diff,
            fullDiff: full.diff,
            pairContributionToDiff: r2(full.diff - withoutPair.diff),
          },
        },
        null,
        2,
      ),
    );
  } else {
    console.log("No suspect expense identified — cannot evaluate cause 2/3");
    console.log(
      JSON.stringify({
        cause1_preExistingImbalance: {
          fullDiff: full.diff,
          balanced: full.balanced,
        },
      }),
    );
  }

  console.log("\n=== Supplement: all capital_contributions for tenant ===");
  console.log(JSON.stringify(allCapital ?? [], null, 2));

  const { data: expenseCats } = await admin
    .from("expense_categories")
    .select("name")
    .order("name");
  console.log("\n=== Global expense_categories lookup ===");
  console.log(expenseCats?.map((c) => c.name));

  const { data: electronicsSubs } = await admin
    .from("expense_subcategories")
    .select("name, category")
    .ilike("name", "%electronic%");
  console.log("\n=== Subcategories matching 'electronic' ===");
  console.log(JSON.stringify(electronicsSubs, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
