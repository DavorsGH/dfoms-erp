/**
 * Staging: AP payment cash outflow — create test AP, partial pay, confirm Cash
 * drops by paid amount and BS reconciles for the payment effect; then full pay;
 * clean up.
 *
 * Usage: npx tsx scripts/verify-ap-payment-cash-staging.ts
 * Staging only (refuses non-staging URL). Does not touch production.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { InventoryBalanceConfig } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import type { PayrollHistoryWagesEntry } from "../app/dashboard/finance/accrued-wages-utils";

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

function rowAmount(
  report: { rows: Array<{ key: string; amounts: number[] }> },
  key: string,
  monthIndex: number,
): number {
  return report.rows.find((r) => r.key === key)?.amounts[monthIndex] ?? 0;
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const TENANT = "00000001-0000-4000-8000-000000000001"; // Davors
const YEAR = 2026;
const AUGUST = 7; // 0-based
const INVOICE_DATE = "2026-08-02";
const DUE_DATE = "2026-09-01";
const MARKER = `AP-CASH-TEST-${Date.now()}`;
const GROSS = 1000;
const PARTIAL = 400;
const FULL = 1000;

async function fetchPayrollHistoryWages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  tenantId: string,
): Promise<PayrollHistoryWagesEntry[]> {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!preferred.error) {
    return (preferred.data as PayrollHistoryWagesEntry[] | null) ?? [];
  }
  if (!String(preferred.error.message).includes("net_only_adjustment")) {
    throw new Error(`payroll_history: ${preferred.error.message}`);
  }
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) throw new Error(`payroll_history: ${fallback.error.message}`);
  return ((fallback.data as Array<{ payroll_month: string; net_pay: number }> | null) ?? []).map(
    (row) => ({
      payroll_month: row.payroll_month,
      net_pay: row.net_pay,
      net_only_adjustment: 0,
    }),
  );
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(key, "Missing service role key");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let testApId: string | null = null;

  async function loadSnapshot() {
    const [
      { data: income, error: incomeError },
      { data: expenses, error: expenseError },
      { data: fixedAssets, error: faError },
      { data: payables, error: apError },
      { data: capital, error: capitalError },
      { data: manual, error: manualError },
      { data: payrollProcessing },
      { data: monthEndClose },
      { data: invConfig },
      { data: rawPurchases },
      { data: productPurchases },
      { data: taxLedger, error: taxError },
      livePayrollBundle,
    ] = await Promise.all([
      admin
        .from("income_register")
        .select(
          "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
        )
        .eq("tenant_id", TENANT)
        .order("date"),
      admin
        .from("expense_register")
        .select(
          "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
        )
        .eq("tenant_id", TENANT)
        .order("date"),
      admin
        .from("fixed_assets")
        .select(
          "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
        )
        .eq("tenant_id", TENANT)
        .order("asset_id"),
      admin
        .from("accounts_payable")
        .select(
          "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
        )
        .eq("tenant_id", TENANT),
      admin
        .from("capital_contributions")
        .select("id, date, contributed_by, amount, description, notes")
        .eq("tenant_id", TENANT),
      admin
        .from("manual_financial_entries")
        .select("*")
        .eq("tenant_id", TENANT)
        .order("period_month"),
      admin.from("payroll_processing").select("*").eq("tenant_id", TENANT),
      admin
        .from("month_end_close")
        .select("month, total_net_pay")
        .eq("tenant_id", TENANT),
      admin
        .from("inventory_balance_config")
        .select("go_live_date, opening_inventory_value, created_at")
        .eq("tenant_id", TENANT)
        .maybeSingle(),
      admin
        .from("raw_material_purchases")
        .select("purchase_date, total_cost, payment_method, created_at")
        .eq("tenant_id", TENANT),
      admin
        .from("product_purchases")
        .select("purchase_date, total_cost, payment_method, created_at")
        .eq("tenant_id", TENANT),
      admin
        .from("tax_ledger_entries")
        .select("entry_date, direction, tax_component, tax_amount, status")
        .eq("tenant_id", TENANT)
        .eq("status", "open")
        .order("entry_date"),
      fetchPayrollLiveRecalcBundle(admin, { tenantId: TENANT }),
    ]);

    for (const [label, err] of [
      ["income", incomeError],
      ["expense", expenseError],
      ["fa", faError],
      ["ap", apError],
      ["capital", capitalError],
      ["manual", manualError],
      ["tax", taxError],
    ] as const) {
      if (err) throw new Error(`${label}: ${err.message}`);
    }

    const payrollHistory = await fetchPayrollHistoryWages(admin, TENANT);
    const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
      payrollHistory,
      (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
      livePayrollBundle.employees,
      livePayrollBundle.liveContext,
    );

    const inventoryConfig: InventoryBalanceConfig | null = invConfig
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

    const inventoryInput = {
      config: inventoryConfig,
      rawMaterials: [] as [],
      finishedProducts: [] as [],
      finishedProductAverageCosts: [] as [],
      cashPurchases: rawPurchases ?? [],
      productCashPurchases: productPurchases ?? [],
    };

    const bs = buildBalanceSheetReport(
      income ?? [],
      expenses ?? [],
      fixedAssets ?? [],
      payables ?? [],
      capital ?? [],
      cashFlowExpenses,
      payrollMerged,
      monthEndClose ?? [],
      YEAR,
      inventoryInput,
      manual ?? [],
      taxLedger ?? [],
    );

    const cf = buildCashFlowReport(
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

    const check = getBalanceCheckForPeriod(bs, AUGUST);
    const testPayable = (payables ?? []).find(
      (p) => p.invoice_number === MARKER,
    );

    return {
      cash: rowAmount(bs, "cash", AUGUST),
      ap: rowAmount(bs, "accounts-payable", AUGUST),
      bsDiff: check.difference,
      bsBalanced: check.isBalanced,
      cfCash: rowAmount(cf, "closing-cash-balance", AUGUST),
      cfApSettlements: rowAmount(cf, "outflow-accounts-payable-settlements", AUGUST),
      amountPaid: testPayable ? Number(testPayable.amount_paid) || 0 : 0,
      balanceDue: testPayable
        ? testPayable.balance_due != null
          ? Number(testPayable.balance_due) || 0
          : Math.max(
              (Number(testPayable.amount) || 0) -
                (Number(testPayable.amount_paid) || 0),
              0,
            )
        : null,
    };
  }

  try {
    const before = await loadSnapshot();
    console.log("\n=== BEFORE (no test AP) ===");
    console.log(
      JSON.stringify(
        {
          cash: before.cash,
          ap: before.ap,
          bsDiff: before.bsDiff,
          cfCash: before.cfCash,
          cfApSettlements: before.cfApSettlements,
        },
        null,
        2,
      ),
    );

    const { data: inserted, error: insertError } = await admin
      .from("accounts_payable")
      .insert({
        tenant_id: TENANT,
        vendor_name: "AP Cash Outflow Test Vendor",
        invoice_number: MARKER,
        expense_category: "Administrative",
        sub_category: "Office Supplies",
        description: "Staging AP cash settlement test — delete after run",
        invoice_date: INVOICE_DATE,
        due_date: DUE_DATE,
        amount: GROSS,
        amount_paid: 0,
        balance_due: GROSS,
        status: "Outstanding",
        notes: MARKER,
      })
      .select("id")
      .single();

    assert(!insertError && inserted, insertError?.message ?? "AP insert failed");
    testApId = (inserted as { id: string }).id;

    const unpaid = await loadSnapshot();
    console.log("\n=== AFTER CREATE (unpaid AP GHS 1000) ===");
    console.log(
      JSON.stringify(
        {
          cash: unpaid.cash,
          ap: unpaid.ap,
          bsDiff: unpaid.bsDiff,
          cashDeltaVsBefore: round2(unpaid.cash - before.cash),
          apDeltaVsBefore: round2(unpaid.ap - before.ap),
          amountPaid: unpaid.amountPaid,
          balanceDue: unpaid.balanceDue,
        },
        null,
        2,
      ),
    );

    assert(
      Math.abs(unpaid.cash - before.cash) < 0.01,
      `Unpaid AP must not move cash (delta=${unpaid.cash - before.cash})`,
    );

    const { error: partialError } = await admin
      .from("accounts_payable")
      .update({
        amount_paid: PARTIAL,
        balance_due: GROSS - PARTIAL,
        status: "Partial",
      })
      .eq("id", testApId)
      .eq("tenant_id", TENANT);
    assert(!partialError, partialError?.message ?? "partial update failed");

    const partial = await loadSnapshot();
    console.log("\n=== AFTER PARTIAL PAY (GHS 400) ===");
    console.log(
      JSON.stringify(
        {
          cash: partial.cash,
          ap: partial.ap,
          bsDiff: partial.bsDiff,
          cashDeltaVsUnpaid: round2(partial.cash - unpaid.cash),
          apDeltaVsUnpaid: round2(partial.ap - unpaid.ap),
          amountPaid: partial.amountPaid,
          balanceDue: partial.balanceDue,
          cfCash: partial.cfCash,
          cfApSettlements: partial.cfApSettlements,
          cfApSettlementsDelta: round2(
            partial.cfApSettlements - unpaid.cfApSettlements,
          ),
        },
        null,
        2,
      ),
    );

    assert(
      Math.abs(partial.cash - unpaid.cash + PARTIAL) < 0.01,
      `Cash should drop by ${PARTIAL}, got delta ${partial.cash - unpaid.cash}`,
    );
    assert(
      Math.abs(partial.ap - unpaid.ap + PARTIAL) < 0.01,
      `AP liability should drop by ${PARTIAL}, got delta ${partial.ap - unpaid.ap}`,
    );
    assert(
      Math.abs(partial.cfCash - partial.cash) < 0.01,
      `BS/CF cash parity failed: BS=${partial.cash} CF=${partial.cfCash}`,
    );
    // Payment effect on BS: cash ↓ and AP ↓ by same amount → diff unchanged
    assert(
      Math.abs(partial.bsDiff - unpaid.bsDiff) < 0.01,
      `BS diff should be unchanged by pure settlement (unpaid=${unpaid.bsDiff}, partial=${partial.bsDiff})`,
    );

    const { error: fullError } = await admin
      .from("accounts_payable")
      .update({
        amount_paid: FULL,
        balance_due: 0,
        status: "Paid",
      })
      .eq("id", testApId)
      .eq("tenant_id", TENANT);
    assert(!fullError, fullError?.message ?? "full update failed");

    const full = await loadSnapshot();
    console.log("\n=== AFTER FULL PAY (GHS 1000 cumulative) ===");
    console.log(
      JSON.stringify(
        {
          cash: full.cash,
          ap: full.ap,
          bsDiff: full.bsDiff,
          cashDeltaVsUnpaid: round2(full.cash - unpaid.cash),
          cashDeltaVsPartial: round2(full.cash - partial.cash),
          apDeltaVsUnpaid: round2(full.ap - unpaid.ap),
          amountPaid: full.amountPaid,
          balanceDue: full.balanceDue,
          cfCash: full.cfCash,
        },
        null,
        2,
      ),
    );

    assert(
      Math.abs(full.cash - unpaid.cash + FULL) < 0.01,
      `Full pay: cash should drop by ${FULL} vs unpaid`,
    );
    assert(
      Math.abs(full.cash - partial.cash + (FULL - PARTIAL)) < 0.01,
      `Full pay delta from partial should be ${FULL - PARTIAL}`,
    );
    assert(
      Math.abs(full.cfCash - full.cash) < 0.01,
      `BS/CF cash parity after full pay failed`,
    );
    assert(
      Math.abs(full.bsDiff - unpaid.bsDiff) < 0.01,
      `BS diff should still be unchanged after full settlement`,
    );

    // Edit down (amount_paid decrease) — cumulative engine must not double-count
    const { error: reduceError } = await admin
      .from("accounts_payable")
      .update({
        amount_paid: PARTIAL,
        balance_due: GROSS - PARTIAL,
        status: "Partial",
      })
      .eq("id", testApId)
      .eq("tenant_id", TENANT);
    assert(!reduceError, reduceError?.message ?? "reduce update failed");

    const reduced = await loadSnapshot();
    console.log("\n=== AFTER REDUCE amount_paid BACK TO 400 ===");
    console.log(
      JSON.stringify(
        {
          cash: reduced.cash,
          cashDeltaVsPartial: round2(reduced.cash - partial.cash),
          amountPaid: reduced.amountPaid,
        },
        null,
        2,
      ),
    );
    assert(
      Math.abs(reduced.cash - partial.cash) < 0.01,
      "Reducing amount_paid must restore cash to partial level (no double entry)",
    );

    console.log("\nPASS: AP payment cash outflow behaves correctly (partial + full + edit-down).");
    console.log(
      JSON.stringify(
        {
          summary: {
            beforeCash: before.cash,
            afterPartialCash: partial.cash,
            afterFullCash: full.cash,
            partialCashDrop: round2(unpaid.cash - partial.cash),
            fullCashDropVsUnpaid: round2(unpaid.cash - full.cash),
            beforeAp: before.ap,
            unpaidAp: unpaid.ap,
            partialAp: partial.ap,
            fullAp: full.ap,
            unpaidBsDiff: unpaid.bsDiff,
            partialBsDiff: partial.bsDiff,
            fullBsDiff: full.bsDiff,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    if (testApId) {
      const { error: delError } = await admin
        .from("accounts_payable")
        .delete()
        .eq("id", testApId)
        .eq("tenant_id", TENANT);
      if (delError) {
        console.error("CLEANUP FAILED:", delError.message, "id=", testApId);
      } else {
        console.log("\nCleanup: deleted test AP", testApId);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
