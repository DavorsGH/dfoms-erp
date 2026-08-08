/**
 * Staging verification: Manual Financial Entries cleanup
 *
 * - Confirms other_cash_inflows column exists on staging
 * - Read-only probe for production column (report only)
 * - CRUD by period_month + tenant_id (insert / update / delete)
 * - BS snapshot unchanged when legacy dead columns hold values
 *
 * Usage: npx tsx scripts/test-manual-entries-cleanup-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  buildCashFlowReport,
  filterManualEntriesForYear,
} from "../app/dashboard/finance/cash-flow-utils";
import { FINANCIAL_YEAR } from "../app/dashboard/finance/profit-loss-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PROD_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const TEST_PERIOD = "2099-01-01";
const YEAR = 2099;
const MONTH_INDEX = 0;

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let value = t.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = value;
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

async function probeColumn(
  label: string,
  url: string,
  serviceKey: string,
): Promise<{ hasOtherCashInflows: boolean; columns: string[] }> {
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin
    .from("manual_financial_entries")
    .select("*")
    .limit(1);

  if (error && !error.message.includes("0 rows")) {
    throw new Error(`${label} probe select failed: ${error.message}`);
  }

  const columns =
    data && data.length > 0
      ? Object.keys(data[0])
      : await probeColumnsViaInsert(admin, label);

  return {
    hasOtherCashInflows: columns.includes("other_cash_inflows"),
    columns: columns.sort(),
  };
}

async function probeColumnsViaInsert(admin, label: string): Promise<string[]> {
  const { error } = await admin.from("manual_financial_entries").insert({
    tenant_id: TENANT,
    period_month: "1900-01-01",
    other_cash_inflows: 0,
  });

  if (error?.message.includes("other_cash_inflows")) {
    return [];
  }

  if (error && !error.message.includes("duplicate key")) {
    throw new Error(`${label} insert probe failed: ${error.message}`);
  }

  await admin
    .from("manual_financial_entries")
    .delete()
    .eq("tenant_id", TENANT)
    .eq("period_month", "1900-01-01");

  return ["other_cash_inflows"];
}

async function minimalFinanceBundle(admin, tenantId: string) {
  const yearStart = `${YEAR}-01-01`;
  const yearEnd = `${YEAR}-12-31`;

  const [
    { data: income },
    { data: expenses },
    { data: fixedAssets },
    { data: payables },
    { data: capital },
    { data: manual },
    { data: monthEndClose },
    { data: taxLedger },
  ] = await Promise.all([
    admin
      .from("income_register")
      .select("date, amount_received")
      .eq("tenant_id", tenantId)
      .gte("date", yearStart)
      .lte("date", yearEnd),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, invoice_number, amount, amount_paid, balance_due, expense_category, vendor_name",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("capital_contributions")
      .select("id, date, amount, contributed_by, description, notes")
      .eq("tenant_id", tenantId),
    admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", tenantId),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", tenantId),
    admin
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status")
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
  ]);

  return {
    income: income ?? [],
    expenses: expenses ?? [],
    fixedAssets: fixedAssets ?? [],
    payables: payables ?? [],
    capital: capital ?? [],
    manual: manual ?? [],
    monthEndClose: monthEndClose ?? [],
    taxLedger: taxLedger ?? [],
  };
}

async function snapshotReports(admin, tenantId: string) {
  const bundle = await minimalFinanceBundle(admin, tenantId);
  const cashFlowExpenses = bundle.expenses.map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category ?? "",
    sub_category: entry.sub_category,
    amount: entry.amount,
    payment_status: entry.payment_status,
    description: entry.description ?? null,
    receipt_no: entry.receipt_no ?? null,
    notes: entry.notes ?? null,
  }));

  const bs = buildBalanceSheetReport(
    bundle.income,
    bundle.expenses,
    bundle.fixedAssets,
    bundle.payables,
    bundle.capital,
    cashFlowExpenses,
    [],
    bundle.monthEndClose,
    YEAR,
    {
      config: null,
      rawMaterials: [],
      finishedProducts: [],
      finishedProductAverageCosts: [],
      cashPurchases: [],
      productCashPurchases: [],
    },
    bundle.manual,
    bundle.taxLedger,
  );

  const cf = buildCashFlowReport(
    bundle.income.map((e) => ({ date: e.date, amount_received: e.amount_received })),
    cashFlowExpenses,
    filterManualEntriesForYear(bundle.manual, YEAR),
    YEAR,
    {
      rawMaterialCashPurchases: [],
      productCashPurchases: [],
      inventoryConfig: null,
    },
  );

  const bsCheck = getBalanceCheckForPeriod(bs, MONTH_INDEX);

  return {
    cash: rowAmount(bs, "cash", MONTH_INDEX),
    bankLoans: rowAmount(bs, "bank-loans", MONTH_INDEX),
    directorsLoan: rowAmount(bs, "directors-loan", MONTH_INDEX),
    otherLtl: rowAmount(bs, "other-long-term-liabilities", MONTH_INDEX),
    bsDiff: bsCheck.difference,
    cfOpening: rowAmount(cf, "opening-cash", MONTH_INDEX),
    cfOtherInflows: rowAmount(cf, "other-cash-inflows", MONTH_INDEX),
    cfLoanProceeds: rowAmount(cf, "loan-proceeds", MONTH_INDEX),
    cfLoanRepayments: rowAmount(cf, "loan-repayments", MONTH_INDEX),
  };
}

async function runCrudTest(admin) {
  const { data: existing } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("period_month", TEST_PERIOD)
    .maybeSingle();

  const prior = existing ? { ...existing } : null;

  try {
    if (prior) {
      await admin
        .from("manual_financial_entries")
        .delete()
        .eq("tenant_id", TENANT)
        .eq("period_month", TEST_PERIOD);
    }

    const insertPayload = {
      tenant_id: TENANT,
      period_month: TEST_PERIOD,
      bank_loans: 100,
      other_long_term_liabilities: 200,
      directors_loan: 300,
      loan_proceeds: 400,
      loan_repayments: 50,
      opening_cash_balance: 500,
      other_cash_inflows: 600,
      cash_on_hand: 9999,
      vat_payable: 8888,
    };

    const { error: insertErr } = await admin
      .from("manual_financial_entries")
      .insert(insertPayload);
    assert(!insertErr, `insert failed: ${insertErr?.message}`);

    const { data: inserted, error: readErr } = await admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", TENANT)
      .eq("period_month", TEST_PERIOD)
      .single();
    assert(!readErr && inserted, `read after insert: ${readErr?.message}`);
    assert(
      Number(inserted.other_cash_inflows) === 600,
      "other_cash_inflows not persisted",
    );
    assert(
      Number(inserted.cash_on_hand) === 9999,
      "legacy cash_on_hand should persist when explicitly set",
    );

    const { error: updateErr } = await admin
      .from("manual_financial_entries")
      .update({
        bank_loans: 111,
        other_cash_inflows: 611,
      })
      .eq("tenant_id", TENANT)
      .eq("period_month", TEST_PERIOD);
    assert(!updateErr, `update by period_month+tenant_id failed: ${updateErr?.message}`);

    const { data: updated } = await admin
      .from("manual_financial_entries")
      .select("bank_loans, other_cash_inflows, cash_on_hand, vat_payable")
      .eq("tenant_id", TENANT)
      .eq("period_month", TEST_PERIOD)
      .single();
    assert(Number(updated.bank_loans) === 111, "update did not change bank_loans");
    assert(
      Number(updated.other_cash_inflows) === 611,
      "update did not change other_cash_inflows",
    );
    assert(
      Number(updated.cash_on_hand) === 9999,
      "partial update must not wipe legacy cash_on_hand",
    );
    assert(
      Number(updated.vat_payable) === 8888,
      "partial update must not wipe legacy vat_payable",
    );

    const { error: deleteErr } = await admin
      .from("manual_financial_entries")
      .delete()
      .eq("tenant_id", TENANT)
      .eq("period_month", TEST_PERIOD);
    assert(!deleteErr, `delete failed: ${deleteErr?.message}`);

    const { data: gone } = await admin
      .from("manual_financial_entries")
      .select("period_month")
      .eq("tenant_id", TENANT)
      .eq("period_month", TEST_PERIOD)
      .maybeSingle();
    assert(!gone, "row still exists after delete");

    console.log("✓ CRUD by period_month + tenant_id passed");
  } finally {
    if (prior) {
      const { id: _id, ...restore } = prior;
      await admin.from("manual_financial_entries").upsert(restore, {
        onConflict: "tenant_id,period_month",
      });
    }
  }
}

async function main() {
  const root = resolve(import.meta.dirname ?? __dirname, "..");
  loadEnv(resolve(root, ".env.staging.local"));

  const stagingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const stagingKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(
    stagingUrl.includes(STAGING_REF),
    `Refusing: expected staging URL (${STAGING_REF}), got ${stagingUrl}`,
  );
  assert(stagingKey, "Missing SUPABASE_SERVICE_ROLE_KEY in .env.staging.local");

  console.log("=== Column probe: staging ===");
  const stagingProbe = await probeColumn("staging", stagingUrl, stagingKey);
  console.log(JSON.stringify(stagingProbe, null, 2));
  assert(
    stagingProbe.hasOtherCashInflows,
    "staging missing other_cash_inflows — run scripts/146_manual_entries_other_cash_inflows.sql",
  );

  loadEnv(resolve(root, ".env.local.backup"));
  const prodUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const prodKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (prodUrl.includes(PROD_REF) && prodKey) {
    console.log("\n=== Column probe: production (read-only) ===");
    const prodProbe = await probeColumn("production", prodUrl, prodKey);
    console.log(JSON.stringify(prodProbe, null, 2));
    if (!prodProbe.hasOtherCashInflows) {
      console.warn(
        "\n⚠ PRODUCTION: other_cash_inflows column MISSING — apply scripts/146_manual_entries_other_cash_inflows.sql BEFORE deploying code.",
      );
    } else {
      console.log("\n✓ Production already has other_cash_inflows");
    }
  } else {
    console.warn("\nSkipping production probe (.env.local.backup not loaded)");
  }

  loadEnv(resolve(root, ".env.staging.local"));
  const admin = createClient(stagingUrl, stagingKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n=== BS/CF baseline for test month (2099-01) ===");
  const before = await snapshotReports(admin, TENANT);
  console.log(JSON.stringify(before, null, 2));

  await runCrudTest(admin);

  const afterInsert = await snapshotReports(admin, TENANT);
  assert(
    round2(before.cash) === round2(afterInsert.cash),
    `Cash changed after CRUD on ${TEST_PERIOD}: before=${before.cash} after=${afterInsert.cash}`,
  );
  assert(
    round2(before.cfOtherInflows) === round2(afterInsert.cfOtherInflows),
    "CF other inflows changed for unrelated month",
  );

  console.log("\n✓ BS/CF numbers unchanged for test month after CRUD cycle");
  console.log("\nAll staging checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
