/**
 * Dual-tenant staging test: Features A/B/C (FA credit, AP payments, DL repayments).
 *
 * Usage: npx tsx scripts/test-fa-credit-ap-director-loan-staging.ts --env-file .env.staging.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  calculateManualLiabilityStockByMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import {
  calculateDirectorsLoanNetByMonth,
  type AccountsPayablePaymentRow,
  type DirectorsLoanRepaymentRow,
} from "../app/dashboard/finance/directors-loan-utils";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const FY = 2099;
const FA_COST = 1600;
const CASH_PAYMENT = 600;
const DL_PAYMENT = 1000;
const REPAYMENT = 1000;
const TOLERANCE = 0.01;

type TenantSpec = { id: string; label: string };
const TENANTS: TenantSpec[] = [
  { id: DAVORS_TENANT_ID, label: "Davors" },
  { id: CAANTA_TENANT_ID, label: "Caanta" },
];

type StepResult = { step: string; pass: boolean; detail: string };

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

function almostEqual(a: number, b: number, tol = TOLERANCE) {
  return Math.abs(a - b) <= tol;
}

function rowAmount(report, key, monthIndex) {
  const row = report.rows.find((r) => r.key === key);
  return row?.amounts[monthIndex] ?? 0;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTenantScenario(admin, tenant: TenantSpec): Promise<StepResult[]> {
  const results: StepResult[] = [];
  const cleanup: {
    assetIds: string[];
    payableIds: string[];
    paymentIds: string[];
    repaymentIds: string[];
    manualIds: string[];
  } = { assetIds: [], payableIds: [], paymentIds: [], repaymentIds: [], manualIds: [] };

  const assetId = `TEST-FA-${tenant.label.toUpperCase()}-${Date.now()}`;
  const augIndex = 7;
  const decIndex = 11;
  const marIndex = 2;

  try {
    const { data: payableId, error: syncError } = await admin.rpc(
      "sync_fixed_asset_payable",
      {
        p_tenant_id: tenant.id,
        p_asset_id: assetId,
        p_vendor_name: `${tenant.label} Monitor Supplier`,
        p_purchase_date: `${FY}-08-15`,
        p_payment_method: "Supplier Credit",
        p_total_cost: FA_COST,
        p_asset_name: `${tenant.label} Test Monitor`,
        p_existing_payable_id: null,
      },
    );
    assert(!syncError, `sync_fixed_asset_payable: ${syncError?.message}`);
    assert(payableId, "payable id missing");
    cleanup.payableIds.push(payableId);

    const { error: faError } = await admin.from("fixed_assets").insert({
      tenant_id: tenant.id,
      asset_id: assetId,
      asset_name: `${tenant.label} Test Monitor`,
      asset_category: "Equipment",
      purchase_date: `${FY}-08-15`,
      original_cost: FA_COST,
      quantity: 1,
      total_cost: FA_COST,
      useful_life_years: 5,
      depreciation_method: "Straight-Line",
      annual_depreciation: FA_COST / 5,
      accumulated_depreciation: 0,
      net_book_value: FA_COST,
      location: "Test",
      payment_method: "Supplier Credit",
      vendor_name: `${tenant.label} Monitor Supplier`,
      accounts_payable_id: payableId,
    });
    assert(!faError, `fixed_assets insert: ${faError?.message}`);
    cleanup.assetIds.push(assetId);

    const apPayments: AccountsPayablePaymentRow[] = [];
    const repayments: DirectorsLoanRepaymentRow[] = [];
    const manualEntries = [];

    const bs1 = buildBalanceSheetReport(
      [],
      [],
      [
        {
          tenant_id: tenant.id,
          original_cost: FA_COST,
          quantity: 1,
          useful_life_years: 5,
          purchase_date: `${FY}-08-15`,
          depreciation_method: "Straight-Line",
          payment_method: "Supplier Credit",
        },
      ],
      [
        {
          invoice_date: `${FY}-08-15`,
          amount: FA_COST,
          amount_paid: 0,
          balance_due: FA_COST,
          vendor_name: "Supplier",
          invoice_number: "X",
          expense_category: "Fixed Assets",
        },
      ],
      [],
      [],
      [],
      [],
      FY,
      {
        config: null,
        rawMaterials: [],
        finishedProducts: [],
        finishedProductAverageCosts: [],
        cashPurchases: [],
        productCashPurchases: [],
      },
      manualEntries,
      [],
      { tenantId: tenant.id, accountsPayablePayments: apPayments, directorsLoanRepayments: repayments },
    );

    const faCashAug = rowAmount(bs1, "cash", augIndex);
    const apAug = rowAmount(bs1, "accounts-payable", augIndex);
    const faNetAug = rowAmount(bs1, "fixed-assets-net", augIndex);
    results.push({
      step: "1 FA on credit (Aug)",
      pass: almostEqual(faCashAug, 0) && almostEqual(apAug, FA_COST) && faNetAug > 0,
      detail: `cash=${faCashAug.toFixed(2)} AP=${apAug.toFixed(2)} FA=${faNetAug.toFixed(2)}`,
    });

    results.push({
      step: "2 AP carry Aug→Dec",
      pass: almostEqual(rowAmount(bs1, "accounts-payable", decIndex), FA_COST),
      detail: `Dec AP=${rowAmount(bs1, "accounts-payable", decIndex).toFixed(2)}`,
    });

    const { data: cashPay, error: cashPayErr } = await admin
      .from("accounts_payable_payments")
      .insert({
        tenant_id: tenant.id,
        accounts_payable_id: payableId,
        payment_date: `${FY}-12-10`,
        amount: CASH_PAYMENT,
        payment_source: "company_cash",
        notes: "E2E company cash partial",
      })
      .select("id")
      .single();
    assert(!cashPayErr, cashPayErr?.message);
    cleanup.paymentIds.push(cashPay.id);
    apPayments.push({
      tenant_id: tenant.id,
      payment_date: `${FY}-12-10`,
      amount: CASH_PAYMENT,
      payment_source: "company_cash",
    });
    await admin.rpc("recompute_accounts_payable_from_payments", { p_ap_id: payableId });

    const bs3 = buildBalanceSheetReport(
      [],
      [],
      [
        {
          tenant_id: tenant.id,
          original_cost: FA_COST,
          quantity: 1,
          useful_life_years: 5,
          purchase_date: `${FY}-08-15`,
          depreciation_method: "Straight-Line",
          payment_method: "Supplier Credit",
        },
      ],
      [
        {
          invoice_date: `${FY}-08-15`,
          amount: FA_COST,
          amount_paid: CASH_PAYMENT,
          balance_due: FA_COST - CASH_PAYMENT,
          vendor_name: "Supplier",
          invoice_number: "X",
          expense_category: "Fixed Assets",
        },
      ],
      [],
      [],
      [],
      [],
      FY,
      {
        config: null,
        rawMaterials: [],
        finishedProducts: [],
        finishedProductAverageCosts: [],
        cashPurchases: [],
        productCashPurchases: [],
      },
      manualEntries,
      [],
      { tenantId: tenant.id, accountsPayablePayments: apPayments, directorsLoanRepayments: repayments },
    );

    const cf3 = buildCashFlowReport(
      [],
      [],
      manualEntries,
      FY,
      { rawMaterialCashPurchases: [], productCashPurchases: [], inventoryConfig: null },
      [
        {
          tenant_id: tenant.id,
          original_cost: FA_COST,
          quantity: 1,
          useful_life_years: 5,
          purchase_date: `${FY}-08-15`,
          depreciation_method: "Straight-Line",
          payment_method: "Supplier Credit",
        },
      ],
      [],
      undefined,
      [
        {
          invoice_date: `${FY}-08-15`,
          amount: FA_COST,
          amount_paid: CASH_PAYMENT,
          balance_due: FA_COST - CASH_PAYMENT,
          vendor_name: "Supplier",
          invoice_number: "X",
          expense_category: "Fixed Assets",
        },
      ],
      { tenantId: tenant.id, accountsPayablePayments: apPayments, directorsLoanRepayments: repayments },
    );

    const apSettleDec =
      cf3.rows.find((r) => r.key === "outflow-accounts-payable-settlements")?.amounts[decIndex] ?? 0;
    results.push({
      step: "3 Partial company cash AP (Dec)",
      pass: almostEqual(apSettleDec, CASH_PAYMENT) && almostEqual(rowAmount(bs3, "accounts-payable", decIndex), FA_COST - CASH_PAYMENT),
      detail: `CF AP settle=${apSettleDec.toFixed(2)} Dec AP=${rowAmount(bs3, "accounts-payable", decIndex).toFixed(2)}`,
    });

    const { data: dlPay, error: dlPayErr } = await admin
      .from("accounts_payable_payments")
      .insert({
        tenant_id: tenant.id,
        accounts_payable_id: payableId,
        payment_date: `${FY}-12-20`,
        amount: DL_PAYMENT,
        payment_source: "directors_loan",
        notes: "E2E director-personal partial",
      })
      .select("id")
      .single();
    assert(!dlPayErr, dlPayErr?.message);
    cleanup.paymentIds.push(dlPay.id);
    apPayments.push({
      tenant_id: tenant.id,
      payment_date: `${FY}-12-20`,
      amount: DL_PAYMENT,
      payment_source: "directors_loan",
    });
    await admin.rpc("recompute_accounts_payable_from_payments", { p_ap_id: payableId });

    const manualStock = calculateManualLiabilityStockByMonth(
      manualEntries,
      "directors_loan",
      FY,
    );
    const dlDec = calculateDirectorsLoanNetByMonth(
      manualStock,
      apPayments,
      repayments,
      tenant.id,
      FY,
    );

    results.push({
      step: "4 Director-personal AP (Dec)",
      pass: almostEqual(dlDec[decIndex], DL_PAYMENT),
      detail: `Dec net DL=${dlDec[decIndex].toFixed(2)}`,
    });

    const { data: repayment, error: repayErr } = await admin
      .from("directors_loan_repayments")
      .insert({
        tenant_id: tenant.id,
        repayment_date: `${FY}-03-15`,
        amount: REPAYMENT,
        applied_to_ap_component: REPAYMENT,
        applied_to_manual_component: 0,
        notes: "E2E repayment",
      })
      .select("id")
      .single();
    assert(!repayErr, repayErr?.message);
    cleanup.repaymentIds.push(repayment.id);
    repayments.push({
      tenant_id: tenant.id,
      repayment_date: `${FY}-03-15`,
      amount: REPAYMENT,
      applied_to_ap_component: REPAYMENT,
      applied_to_manual_component: 0,
    });

    const dlMar = calculateDirectorsLoanNetByMonth(
      Array.from({ length: 13 }, () => 0),
      apPayments,
      repayments,
      tenant.id,
      FY,
    );
    const cf5 = buildCashFlowReport(
      [],
      [],
      manualEntries,
      FY,
      { rawMaterialCashPurchases: [], productCashPurchases: [], inventoryConfig: null },
      [
        {
          tenant_id: tenant.id,
          original_cost: FA_COST,
          quantity: 1,
          useful_life_years: 5,
          purchase_date: `${FY}-08-15`,
          depreciation_method: "Straight-Line",
          payment_method: "Supplier Credit",
        },
      ],
      [],
      undefined,
      [
        {
          invoice_date: `${FY}-08-15`,
          amount: FA_COST,
          amount_paid: FA_COST,
          balance_due: 0,
          vendor_name: "Supplier",
          invoice_number: "X",
          expense_category: "Fixed Assets",
        },
      ],
      { tenantId: tenant.id, accountsPayablePayments: apPayments, directorsLoanRepayments: repayments },
    );
    const dlRepayMar =
      cf5.rows.find((r) => r.key === "directors-loan-repayments")?.amounts[marIndex] ?? 0;

    results.push({
      step: "5 Director loan repayment (Mar)",
      pass: almostEqual(dlMar[marIndex], 0) && almostEqual(dlRepayMar, REPAYMENT),
      detail: `Mar net DL=${dlMar[marIndex].toFixed(2)} CF repay=${dlRepayMar.toFixed(2)}`,
    });

    const bsFinal = buildBalanceSheetReport(
      [],
      [],
      [
        {
          tenant_id: tenant.id,
          original_cost: FA_COST,
          quantity: 1,
          useful_life_years: 5,
          purchase_date: `${FY}-08-15`,
          depreciation_method: "Straight-Line",
          payment_method: "Supplier Credit",
        },
      ],
      [
        {
          invoice_date: `${FY}-08-15`,
          amount: FA_COST,
          amount_paid: FA_COST,
          balance_due: 0,
          vendor_name: "Supplier",
          invoice_number: "X",
          expense_category: "Fixed Assets",
        },
      ],
      [],
      [],
      [],
      [],
      FY,
      {
        config: null,
        rawMaterials: [],
        finishedProducts: [],
        finishedProductAverageCosts: [],
        cashPurchases: [],
        productCashPurchases: [],
      },
      manualEntries,
      [],
      { tenantId: tenant.id, accountsPayablePayments: apPayments, directorsLoanRepayments: repayments },
    );
    const check = getBalanceCheckForPeriod(bsFinal, decIndex);
    results.push({
      step: "6 BS balanced (Dec snapshot)",
      pass: check.isBalanced,
      detail: `diff=${check.difference.toFixed(2)}`,
    });

    let isolationThrew = false;
    try {
      calculateDirectorsLoanNetByMonth(
        Array.from({ length: 13 }, () => 0),
        apPayments,
        repayments,
        tenant.id === DAVORS_TENANT_ID ? CAANTA_TENANT_ID : DAVORS_TENANT_ID,
        FY,
      );
    } catch {
      isolationThrew = true;
    }
    results.push({
      step: "7 Cross-tenant calc isolation",
      pass: isolationThrew,
      detail: isolationThrew ? "tenant mismatch rejected" : "NO isolation guard",
    });
  } finally {
    for (const id of cleanup.repaymentIds) {
      await admin.from("directors_loan_repayments").delete().eq("id", id);
    }
    for (const id of cleanup.paymentIds) {
      await admin.from("accounts_payable_payments").delete().eq("id", id);
    }
    for (const assetId of cleanup.assetIds) {
      await admin.from("fixed_assets").delete().eq("asset_id", assetId).eq("tenant_id", tenant.id);
    }
    for (const id of cleanup.payableIds) {
      await admin.from("accounts_payable").delete().eq("id", id);
    }
    for (const id of cleanup.manualIds) {
      await admin.from("manual_financial_entries").delete().eq("id", id);
    }
  }

  return results;
}

async function main() {
  const envFile = process.argv.includes("--env-file")
    ? process.argv[process.argv.indexOf("--env-file") + 1]
    : ".env.staging.local";
  loadEnv(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.includes("wieflwbfdmjtsdnwbfii") || !key) {
    throw new Error("Staging Supabase URL/service role required in env file");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const allResults = new Map<string, StepResult[]>();

  for (const tenant of TENANTS) {
    console.log(`\n========== ${tenant.label} (${tenant.id}) ==========`);
    const results = await runTenantScenario(admin, tenant);
    allResults.set(tenant.label, results);
    for (const r of results) {
      console.log(`${r.pass ? "PASS" : "FAIL"} Step ${r.step}: ${r.detail}`);
    }
  }

  console.log("\n========== Side-by-side results ==========");
  const steps = allResults.get("Davors")!.map((r) => r.step);
  console.log("| Step | Davors | Caanta |");
  console.log("|------|--------|--------|");
  for (const step of steps) {
    const d = allResults.get("Davors")!.find((r) => r.step === step)!;
    const c = allResults.get("Caanta")!.find((r) => r.step === step)!;
    console.log(
      `| ${step} | ${d.pass ? "PASS" : "FAIL"} (${d.detail}) | ${c.pass ? "PASS" : "FAIL"} (${c.detail}) |`,
    );
  }

  const anyFail = [...allResults.values()].some((rows) => rows.some((r) => !r.pass));
  if (anyFail) {
    process.exit(1);
  }
  console.log("\nALL PASS — dual-tenant Features A/B/C staging verification");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
