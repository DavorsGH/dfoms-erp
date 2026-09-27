// @ts-nocheck
/**
 * BS baseline investigation for supplier contract staging tests.
 * npx tsx scripts/probe-supplier-contract-bs-baseline-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { generateSupplierContractAccountsPayableCore } from "../utils/supplier-contract-ap-generation-core";
import { SUPPLIER_CONTRACT_SOURCE_TYPE } from "../utils/supplier-contracts-types";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  buildPurchaseTaxLedgerRpcPayload,
} from "../app/dashboard/finance/tax-ledger-sync";
import { computePurchaseTaxAmounts } from "../app/dashboard/finance/tax-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const FY = 2026;
const SEP_INDEX = 8;
const OCT_INDEX = 9;
const NOV_INDEX = 10;

function loadEnv(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

async function bsDiff(admin, tenantId, periodIndex) {
  const data = await fetchBalanceSheetPageData(admin, tenantId, {
    activeBusinessUnitId: null,
    viewAllBusinessUnits: true,
  });
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
    data.initialWelfareFundEntries,
    {
      tenantId,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  const check = getBalanceCheckForPeriod(report, periodIndex);
  return {
    diff: round2(check.difference),
    balanced: check.isBalanced,
    assets: round2(check.totalAssets),
    liabEq: round2(check.totalLiabilitiesAndEquity),
  };
}

async function recordApPayment(admin, tenantId, apId, paymentDate, amount, buId) {
  await admin.from("accounts_payable_payments").insert({
    tenant_id: tenantId,
    accounts_payable_id: apId,
    payment_date: paymentDate,
    amount,
    payment_source: "company_cash",
    notes: "BS probe payment",
    business_unit_id: buId,
  });
  await admin.rpc("recompute_accounts_payable_from_payments", { p_ap_id: apId });
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  if (ref !== STAGING_REF) throw new Error(`Not staging: ${ref}`);

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tenantId =
    process.env.STAGING_TEST_TENANT_ID ??
    (await admin.from("tenants").select("id, name").limit(1)).data?.[0]?.id;
  const tenantName =
    (await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle()).data
      ?.name ?? "?";

  console.log("=== 1a) Test tenant (same rule as test-supplier-contracts-staging.ts) ===");
  console.log(`tenant_id: ${tenantId}`);
  console.log(`tenant_name: ${tenantName}`);
  console.log("BU scope in BS helpers: viewAllBusinessUnits=true, activeBusinessUnitId=null");

  console.log("\n=== 1b) BS diff NOW (post cleanup) Sep/Oct/Nov 2026 ===");
  async function printBsForTenant(label, tid) {
    for (const [month, idx] of [
      ["Sep 2026", SEP_INDEX],
      ["Oct 2026", OCT_INDEX],
      ["Nov 2026", NOV_INDEX],
    ]) {
      const r = await bsDiff(admin, tid, idx);
      console.log(
        `[${label}] ${month}: diff=${r.diff} balanced=${r.balanced} assets=${r.assets} liab+eq=${r.liabEq}`,
      );
    }
  }
  await printBsForTenant("test tenant", tenantId);
  const DAVORS = "00000001-0000-4000-8000-000000000001";
  if (tenantId !== DAVORS) {
    await printBsForTenant("Davors Facilities (reference)", DAVORS);
  }

  console.log("\n=== 1c) When original test captured baseline ===");
  console.log(
    "AFTER: supplier insert, contract insert, initial amendment insert",
  );
  console.log("BEFORE: first generateSupplierContractAccountsPayableCore (Oct AP cron)");
  console.log(
    "(Original test did NOT log baseline diff; logged diff during assertBalanceSheetBalanced after replacement.)",
  );

  const tag = `SPC-BS-PROBE-${Date.now()}`;
  console.log(`\n=== 1d) Step-by-step scenario tag=${tag} ===`);

  const steps = [];
  async function snap(label) {
    const sep = await bsDiff(admin, tenantId, SEP_INDEX);
    const oct = await bsDiff(admin, tenantId, OCT_INDEX);
    const nov = await bsDiff(admin, tenantId, NOV_INDEX);
    const row = { label, sep: sep.diff, oct: oct.diff, nov: nov.diff };
    steps.push(row);
    console.log(
      `${label}: Sep diff=${sep.diff} Oct diff=${oct.diff} Nov diff=${nov.diff}`,
    );
    return row;
  }

  await snap("0 baseline (no test data)");

  const { data: supplier } = await admin
    .from("suppliers")
    .insert({ tenant_id: tenantId, name: `${tag} Supplier`, is_active: true })
    .select("id, name")
    .single();

  const { data: contractNumber } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "SPC",
    p_padding: 4,
  });

  const { data: contract } = await admin
    .from("supplier_contracts")
    .insert({
      tenant_id: tenantId,
      supplier_id: supplier.id,
      supplier_name: supplier.name,
      contract_number: contractNumber,
      contract_sequence: Math.floor(Date.now() % 100000),
      agreement_type: "verbal",
      start_date: "2026-10-01",
      end_date: "2026-12-31",
      auto_renew: false,
      status: "active",
      expense_category: "Transport",
      sub_category: "Transport",
      wht_rate: 0,
      next_billing_date: "2026-10-01",
      credit_balance: 0,
      notes: tag,
    })
    .select("*")
    .single();

  await admin.from("supplier_contract_amendments").insert({
    tenant_id: tenantId,
    contract_id: contract.id,
    effective_date: "2026-10-01",
    new_monthly_amount: 2000,
    change_reason: "Initial agreement",
  });

  await snap("1 after contract+amendment (mirrors OLD test baseline timing)");

  await generateSupplierContractAccountsPayableCore({
    admin,
    tenantId,
    asOf: "2026-10-01",
  });

  const { data: apsOct } = await admin
    .from("accounts_payable")
    .select("*")
    .eq("source_type", SUPPLIER_CONTRACT_SOURCE_TYPE)
    .eq("source_id", contract.id);
  const octAp = apsOct[0];
  await snap("2 after Oct AP created (2000)");

  await recordApPayment(admin, tenantId, octAp.id, "2026-10-05", 1000, contract.business_unit_id);
  await snap("3 after partial payment 1000");

  await admin.rpc("record_supplier_contract_replacement_payment", {
    p_tenant_id: tenantId,
    p_contract_id: contract.id,
    p_created_by: null,
    p_service_date: "2026-10-10",
    p_replacement_name: "Temp Driver",
    p_deduction_amount: 200,
    p_payment_method: "company_cash",
    p_notes: `${tag} rep200`,
  });
  await snap("4 after replacement 200 (accrual 1800)");

  await recordApPayment(admin, tenantId, octAp.id, "2026-10-25", 800, contract.business_unit_id);
  await snap("5 after pay remaining 800");

  await admin.rpc("record_supplier_contract_replacement_payment", {
    p_tenant_id: tenantId,
    p_contract_id: contract.id,
    p_created_by: null,
    p_service_date: "2026-10-20",
    p_replacement_name: "Temp Driver 2",
    p_deduction_amount: 300,
    p_payment_method: "company_cash",
    p_notes: `${tag} rep300`,
  });
  await snap("6 after replacement 300 (credit 300)");

  await admin.from("supplier_contract_amendments").insert({
    tenant_id: tenantId,
    contract_id: contract.id,
    effective_date: "2026-11-01",
    previous_monthly_amount: 2000,
    new_monthly_amount: 2200,
    change_reason: "Nov increase",
  });

  await generateSupplierContractAccountsPayableCore({
    admin,
    tenantId,
    asOf: "2026-11-01",
  });
  await snap("7 after Nov AP (1900)");

  console.log("\n=== Manual AP control (same amounts/dates, no supplier_contract source) ===");
  const manualTag = `${tag}-MANUAL`;
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht: 2000,
    whtRatePct: 0,
    whtAmount: 0,
    inputVatAmount: 0,
  });
  const manualApId = "00000000-0000-4000-8000-000000000099";
  const taxRows = buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: manualApId,
    entryDate: "2026-10-01",
    grossBeforeWht: 2000,
    whtRatePct: null,
    whtAmount: 0,
    inputTaxComponent: null,
    inputVatAmount: 0,
    counterpartyName: "Manual control vendor",
    notes: manualTag,
  });

  const beforeManual = await bsDiff(admin, tenantId, OCT_INDEX);
  const { error: manErr } = await admin.rpc("save_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: null,
    p_business_unit_id: null,
    p_vendor_name: "Manual control vendor",
    p_invoice_number: `${manualTag}-INV`,
    p_expense_category: "Transport",
    p_sub_category: "Transport",
    p_description: manualTag,
    p_invoice_date: "2026-10-01",
    p_due_date: "2026-10-31",
    p_amount: purchaseTax.netOfTaxAmount,
    p_amount_paid: 0,
    p_balance_due: purchaseTax.netOfTaxAmount,
    p_status: "Outstanding",
    p_gross_before_wht: 2000,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: 2000,
    p_notes: manualTag,
    p_source_type: null,
    p_tax_rows: taxRows,
  });
  if (manErr) console.log("Manual AP create error:", manErr.message);
  else {
    const afterManual = await bsDiff(admin, tenantId, OCT_INDEX);
    console.log(
      `Manual AP Oct diff: before=${beforeManual.diff} after=${afterManual.diff} delta=${round2(afterManual.diff - beforeManual.diff)}`,
    );
    const { data: created } = await admin
      .from("accounts_payable")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("invoice_number", `${manualTag}-INV`)
      .maybeSingle();
    if (created?.id) {
      await admin.rpc("delete_accounts_payable", {
        p_tenant_id: tenantId,
        p_ap_id: created.id,
      });
    }
  }

  const baselineOct = steps[0]?.oct ?? 0;
  const contractIntroducedImbalance = steps.some(
    (s, i) => i > 0 && Math.abs(s.oct - baselineOct) > 0.02,
  );
  console.log("\n=== Summary ===");
  console.log(
    `Oct diff changed from step 0 baseline (${baselineOct}) during contract scenario: ${contractIntroducedImbalance}`,
  );
  if (contractIntroducedImbalance) {
    for (const s of steps) {
      if (Math.abs(s.oct - baselineOct) > 0.02) {
        console.log(`  First Oct shift at: ${s.label} -> ${s.oct}`);
        break;
      }
    }
  }

  console.log("\n=== Cleanup ===");
  await admin
    .from("accounts_payable_payments")
    .delete()
    .eq("accounts_payable_id", octAp.id);
  await admin.from("supplier_contract_deductions").delete().eq("contract_id", contract.id);
  await admin.from("accounts_payable").delete().eq("source_id", contract.id);
  await admin.from("supplier_contract_amendments").delete().eq("contract_id", contract.id);
  await admin.from("supplier_contracts").delete().eq("id", contract.id);
  await admin.from("suppliers").delete().eq("id", supplier.id);
  await admin.from("expense_register").delete().like("notes", `%${tag}%`);
  console.log("Cleanup done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
