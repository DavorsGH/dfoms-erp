// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { generateSupplierContractAccountsPayableCore } from "../utils/supplier-contract-ap-generation-core";
import {
  SUPPLIER_CONTRACT_SOURCE_TYPE,
} from "../utils/supplier-contracts-types";
import { buildAccountsPayableAccrualReceiptNo } from "../app/dashboard/finance/accounts-payable-accrual-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  getBalanceSheetAmountForMonth,
} from "../app/dashboard/finance/balance-sheet-utils";
import { getTaxExclusiveExpenseAmount } from "../app/dashboard/finance/profit-loss-utils";
import {
  buildPurchaseTaxLedgerRpcPayload,
} from "../app/dashboard/finance/tax-ledger-sync";
import { computePurchaseTaxAmounts } from "../app/dashboard/finance/tax-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DEFAULT_STAGING_TEST_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const SEP_INDEX = 8;
const OCT_INDEX = 9;
const NOV_INDEX = 10;
const DEC_INDEX = 11;
const REG_STAMP = "SPC-REG-311";

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

function assert(c, m) {
  if (!c) throw new Error(m);
}

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

async function sumContractOctoberPl(
  admin,
  tenantId,
  octApId,
  tag,
  category,
  subCategory,
) {
  const accrualReceipt = buildAccountsPayableAccrualReceiptNo(octApId);
  const { data: rows } = await admin
    .from("expense_register")
    .select(
      "date, expense_category, sub_category, amount, net_of_tax_amount, input_vat_amount, receipt_no, notes",
    )
    .eq("tenant_id", tenantId)
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31");
  return round2(
    (rows ?? [])
      .filter(
        (e) =>
          e.expense_category === category &&
          e.sub_category === subCategory &&
          (e.receipt_no === accrualReceipt || String(e.notes ?? "").includes(tag)),
      )
      .reduce((sum, e) => sum + getTaxExclusiveExpenseAmount(e), 0),
  );
}

async function listSaveApSignatures(pgClient) {
  const { rows } = await pgClient.query(`
    SELECT pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'save_accounts_payable'
    ORDER BY 1
  `);
  return rows.map((r) => r.args);
}

async function recordApPayment(admin, tenantId, apId, paymentDate, amount, businessUnitId) {
  const { error: insErr } = await admin.from("accounts_payable_payments").insert({
    tenant_id: tenantId,
    accounts_payable_id: apId,
    payment_date: paymentDate,
    amount,
    payment_source: "company_cash",
    notes: "SPC staging test payment",
    business_unit_id: businessUnitId,
  });
  assert(!insErr, insErr?.message ?? "payment insert failed");
  const { error: recalcErr } = await admin.rpc("recompute_accounts_payable_from_payments", {
    p_ap_id: apId,
  });
  assert(!recalcErr, recalcErr?.message ?? "recompute AP failed");
}

async function deleteAccountsPayableViaRpc(admin, tenantId, apId) {
  const { error } = await admin.rpc("delete_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: apId,
  });
  if (error) throw new Error(error.message);
}

async function deleteAccountsPayableForContract(admin, tenantId, contractId) {
  const { data: aps } = await admin
    .from("accounts_payable")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("source_id", contractId);
  for (const row of aps ?? []) {
    await deleteAccountsPayableViaRpc(admin, tenantId, row.id);
  }
}

async function cleanupSupplierContractTestData(admin, tenantId, ctx) {
  const { tag, contractId, supplierId } = ctx;
  if (contractId) {
    await admin.from("supplier_contract_deductions").delete().eq("contract_id", contractId);
    await deleteAccountsPayableForContract(admin, tenantId, contractId);
    await admin.from("supplier_contract_amendments").delete().eq("contract_id", contractId);
    await admin.from("supplier_contracts").delete().eq("id", contractId);
  }
  if (supplierId) {
    await admin.from("suppliers").delete().eq("id", supplierId);
  }
  if (tag) {
    await admin.from("expense_register").delete().like("notes", `${tag}%`);
  }
}

async function proveDirectApDeleteTrigger(
  admin,
  pgClient,
  tenantId,
  expectedOctDiff,
) {
  const tag = `SPC-TRIGGER-${Date.now()}`;
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht: 100,
    whtRatePct: 0,
    whtAmount: 0,
    inputVatAmount: 0,
  });
  const taxRows = buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: tag,
    entryDate: "2026-10-01",
    grossBeforeWht: 100,
    whtRatePct: null,
    whtAmount: 0,
    inputTaxComponent: null,
    inputVatAmount: 0,
    counterpartyName: tag,
    notes: tag,
  });
  const { data: created, error: createErr } = await admin.rpc("save_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: null,
    p_business_unit_id: null,
    p_vendor_name: tag,
    p_invoice_number: `${tag}-INV`,
    p_expense_category: "Administrative",
    p_sub_category: "General",
    p_description: tag,
    p_invoice_date: "2026-10-01",
    p_due_date: "2026-10-31",
    p_amount: purchaseTax.netOfTaxAmount,
    p_amount_paid: 0,
    p_balance_due: purchaseTax.netOfTaxAmount,
    p_status: "Outstanding",
    p_gross_before_wht: 100,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: 100,
    p_notes: tag,
    p_source_type: null,
    p_tax_rows: taxRows,
  });
  assert(!createErr && created?.id, createErr?.message ?? "trigger proof AP create failed");
  const apId = created.id;
  const receiptNo = buildAccountsPayableAccrualReceiptNo(apId);
  const { data: accrualBefore } = await admin
    .from("expense_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();
  assert(accrualBefore?.id, "trigger proof: accrual row missing after create");

  await pgClient.query(`DELETE FROM accounts_payable WHERE id = $1 AND tenant_id = $2`, [
    apId,
    tenantId,
  ]);

  const { data: accrualAfter } = await admin
    .from("expense_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();
  assert(!accrualAfter?.id, "trigger proof: accrual row still present after direct DELETE");

  const { check } = await loadBalanceSheetCheck(admin, tenantId, OCT_INDEX);
  assert(
    Math.abs(check.difference - expectedOctDiff) <= 0.02,
    `trigger proof: Oct BS diff ${check.difference} != baseline ${expectedOctDiff}`,
  );
  console.log("PASS: direct DELETE on accounts_payable removes accrual; BS diff unchanged");
}

async function loadBalanceSheetCheck(admin, tenantId, periodIndex) {
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
  return { report, data, check: getBalanceCheckForPeriod(report, periodIndex) };
}

async function assertBalanceSheetBalanced(admin, tenantId, periodIndex, label, baselineDiff = null) {
  const { report, data, check } = await loadBalanceSheetCheck(admin, tenantId, periodIndex);
  if (baselineDiff == null) {
    assert(check.isBalanced, `${label}: BS not balanced (diff ${check.difference})`);
  } else {
    assert(
      Math.abs(check.difference - baselineDiff) <= 0.02,
      `${label}: BS diff moved from ${baselineDiff} to ${check.difference}`,
    );
  }

  const apRow = report.rows.find((r) => r.key === "accounts-payable");
  assert(apRow, `${label}: missing AP row`);
  const bsAp = round2(getBalanceSheetAmountForMonth(apRow, periodIndex));
  console.log(`${label}: accounts-payable BS amount = ${bsAp}, diff = ${check.difference}`);
  return { report, data, check };
}

async function runApRegression(admin, tenantId, pgClient) {
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht: 500,
    whtRatePct: 0,
    whtAmount: 0,
    inputVatAmount: 0,
  });
  const taxRows = buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: "00000000-0000-4000-8000-000000000099",
    entryDate: "2099-01-15",
    grossBeforeWht: purchaseTax.grossBeforeWht,
    whtRatePct: null,
    whtAmount: 0,
    inputTaxComponent: null,
    inputVatAmount: 0,
    counterpartyName: `${REG_STAMP} Vendor`,
    notes: REG_STAMP,
  });

  const { data: created, error: createErr } = await admin.rpc("save_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: null,
    p_business_unit_id: null,
    p_vendor_name: `${REG_STAMP} Vendor`,
    p_invoice_number: `${REG_STAMP}-INV`,
    p_expense_category: "Administrative",
    p_sub_category: "General",
    p_description: REG_STAMP,
    p_invoice_date: "2099-01-15",
    p_due_date: "2099-02-15",
    p_amount: purchaseTax.netOfTaxAmount,
    p_amount_paid: 0,
    p_balance_due: purchaseTax.netOfTaxAmount,
    p_status: "Outstanding",
    p_gross_before_wht: purchaseTax.grossBeforeWht,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: purchaseTax.netOfTaxAmount,
    p_notes: REG_STAMP,
    p_source_type: null,
    p_tax_rows: taxRows,
  });
  assert(!createErr, createErr?.message ?? "regression AP create failed");
  const apId = created?.id;
  assert(apId, "regression AP id missing");

  await recordApPayment(admin, tenantId, apId, "2099-01-20", 200, null);

  const { data: updatedAp } = await admin
    .from("accounts_payable")
    .select("*")
    .eq("id", apId)
    .single();
  assert(round2(updatedAp.amount_paid) === 200, "regression AP payment not applied");

  const { error: delErr } = await admin.rpc("delete_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: apId,
  });
  assert(!delErr, delErr?.message ?? "regression AP delete failed");

  const creditAssetId = `${REG_STAMP}-FA`;
  const { error: faErr } = await admin.rpc("save_fixed_asset", {
    p_tenant_id: tenantId,
    p_asset_id: creditAssetId,
    p_is_update: false,
    p_business_unit_id: null,
    p_asset_name: `${REG_STAMP} Asset`,
    p_asset_category: "Equipment",
    p_purchase_date: "2099-01-15",
    p_original_cost: 1000,
    p_quantity: 1,
    p_total_cost: 1000,
    p_useful_life_years: 5,
    p_depreciation_method: "Straight-Line",
    p_annual_depreciation: 200,
    p_accumulated_depreciation: 0,
    p_net_book_value: 1000,
    p_location: "HQ",
    p_notes: REG_STAMP,
    p_payment_method: "Supplier Credit",
    p_vendor_name: `${REG_STAMP} FA Vendor`,
    p_approved_by: "System",
    p_gross_before_wht: 1000,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: 1000,
    p_existing_payable_id: null,
    p_tax_rows: [],
  });
  assert(!faErr, faErr?.message ?? "regression FA failed");

  const { data: faRow } = await admin
    .from("fixed_assets")
    .select("accounts_payable_id")
    .eq("tenant_id", tenantId)
    .eq("asset_id", creditAssetId)
    .single();
  assert(faRow?.accounts_payable_id, "regression FA missing linked AP");

  await admin.rpc("delete_fixed_asset", {
    p_tenant_id: tenantId,
    p_asset_id: creditAssetId,
  });

  const { data: product } = await admin
    .from("finished_products")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();
  const { data: supplier } = await admin
    .from("suppliers")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1)
    .maybeSingle();

  if (product?.id && supplier?.id) {
    try {
      const { rows: plotRows } = await pgClient.query(
        `SELECT public.generate_next_code($1::uuid, 'PLOT', 4) AS code`,
        [tenantId],
      );
      const batchNumber = plotRows[0]?.code ?? `${REG_STAMP}-BATCH`;
      await pgClient.query(
        `
        SELECT public.create_product_purchase(
          '2099-01-15'::date,
          $1::uuid,
          1::numeric,
          50::numeric,
          $2::uuid,
          'Supplier Credit'::text,
          $3::text,
          $4::text,
          NULL::uuid,
          NULL::uuid,
          NULL::date,
          NULL::date,
          NULL::uuid
        )
        `,
        [product.id, supplier.id, REG_STAMP, batchNumber],
      );
      const { rows: creditAp } = await pgClient.query(
        `
        SELECT ap.id FROM accounts_payable ap
        WHERE ap.tenant_id = $1 AND ap.notes LIKE $2
        LIMIT 1
        `,
        [tenantId, `%${REG_STAMP}%`],
      );
      assert(creditAp.length > 0, "regression credit product purchase missing AP");
      await pgClient.query(`DELETE FROM product_purchases WHERE notes = $1`, [REG_STAMP]);
      await deleteAccountsPayableViaRpc(admin, tenantId, creditAp[0].id);
      console.log("PASS: credit product purchase creates AP");
    } catch (purchaseErr) {
      const msg =
        purchaseErr instanceof Error ? purchaseErr.message : String(purchaseErr);
      if (msg.includes("tenant_id is required")) {
        console.log(
          "SKIP: credit product purchase (requires authenticated tenant JWT; run UI/API soak separately)",
        );
      } else {
        throw purchaseErr;
      }
    }
  }

  await pgClient.query(`DELETE FROM expense_register WHERE tenant_id = $1 AND notes LIKE $2`, [
    tenantId,
    `%${REG_STAMP}%`,
  ]);
  const { rows: regApRows } = await pgClient.query(
    `SELECT id FROM accounts_payable WHERE tenant_id = $1 AND notes = $2`,
    [tenantId, REG_STAMP],
  );
  for (const row of regApRows) {
    await deleteAccountsPayableViaRpc(admin, tenantId, row.id);
  }

  console.log("PASS: AP/FA/purchase regression (save_accounts_payable not ambiguous)");
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  assert(ref === STAGING_REF, `Not staging: ${ref}`);
  assert(ref !== PRODUCTION_REF, "Refusing production");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const signatures = await listSaveApSignatures(pgClient);
  console.log("save_accounts_payable signatures on staging:");
  for (const sig of signatures) {
    console.log(`  save_accounts_payable(${sig})`);
  }
  assert(
    signatures.length === 1,
    `Expected 1 save_accounts_payable overload, found ${signatures.length}`,
  );

  const tenantId =
    process.env.STAGING_TEST_TENANT_ID?.trim() || DEFAULT_STAGING_TEST_TENANT_ID;
  console.log(`Using staging test tenant: ${tenantId}`);

  const { check: octBsBaseline } = await loadBalanceSheetCheck(admin, tenantId, OCT_INDEX);
  const { check: novBsBaseline } = await loadBalanceSheetCheck(admin, tenantId, NOV_INDEX);
  console.log(
    `BS baseline (before test data): Oct diff=${octBsBaseline.difference} Nov diff=${novBsBaseline.difference}`,
  );

  const tag = `SPC-TEST-${Date.now()}`;
  const category = "Transport";
  const subCategory = "Transport";
  let supplier = null;
  let contract = null;

  try {
  const { data: supplierRow, error: supErr } = await admin
    .from("suppliers")
    .insert({ tenant_id: tenantId, name: `${tag} Supplier`, is_active: true })
    .select("id, name")
    .single();
  assert(!supErr && supplierRow, supErr?.message ?? "supplier create failed");
  supplier = supplierRow;

  const { data: contractNumber } = await admin.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "SPC",
    p_padding: 4,
  });

  const { data: contractRow, error: cErr } = await admin
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
      expense_category: category,
      sub_category: subCategory,
      wht_rate: 0,
      next_billing_date: "2026-10-01",
      credit_balance: 0,
      notes: tag,
    })
    .select("*")
    .single();
  assert(!cErr && contractRow, cErr?.message ?? "contract create failed");
  contract = contractRow;

  await admin.from("supplier_contract_amendments").insert({
    tenant_id: tenantId,
    contract_id: contract.id,
    effective_date: "2026-10-01",
    new_monthly_amount: 2000,
    change_reason: "Initial agreement",
  });

  const cron1 = await generateSupplierContractAccountsPayableCore({
    admin,
    tenantId,
    asOf: "2026-10-01",
  });
  const cron2 = await generateSupplierContractAccountsPayableCore({
    admin,
    tenantId,
    asOf: "2026-10-01",
  });
  assert(cron1.created === 1, `Expected 1 AP created, got ${cron1.created}`);
  assert(cron2.created === 0, `Second cron should be idempotent, created ${cron2.created}`);

  const { data: apsOct } = await admin
    .from("accounts_payable")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("source_type", SUPPLIER_CONTRACT_SOURCE_TYPE)
    .eq("source_id", contract.id);
  assert((apsOct ?? []).length === 1, `Expected 1 Oct AP, got ${(apsOct ?? []).length}`);
  const octAp = apsOct[0];
  assert(round2(octAp.gross_before_wht) === 2000, `Oct AP gross ${octAp.gross_before_wht}`);

  await recordApPayment(admin, tenantId, octAp.id, "2026-10-05", 1000, contract.business_unit_id);

  await admin.rpc("record_supplier_contract_replacement_payment", {
    p_tenant_id: tenantId,
    p_contract_id: contract.id,
    p_created_by: null,
    p_service_date: "2026-10-10",
    p_replacement_name: "Temp Driver",
    p_deduction_amount: 200,
    p_payment_method: "company_cash",
    p_notes: `${tag} replacement 200`,
  });

  const accrualReceipt = buildAccountsPayableAccrualReceiptNo(octAp.id);
  const { data: accrualRow } = await admin
    .from("expense_register")
    .select("amount, gross_before_wht, net_of_tax_amount")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", accrualReceipt)
    .single();
  assert(accrualRow, "Missing AP-ACCRUAL expense row");
  assert(
    round2(accrualRow.gross_before_wht ?? accrualRow.amount) === 1800,
    `AP-ACCRUAL should be 1800, got ${accrualRow.gross_before_wht ?? accrualRow.amount}`,
  );

  await assertBalanceSheetBalanced(
    admin,
    tenantId,
    OCT_INDEX,
    "October 2026",
    octBsBaseline.difference,
  );

  const plOct = await sumContractOctoberPl(
    admin,
    tenantId,
    octAp.id,
    tag,
    category,
    subCategory,
  );
  assert(plOct === 2000, `October contract P&L expected 2000, got ${plOct}`);

  const { data: apAfter200 } = await admin
    .from("accounts_payable")
    .select("*")
    .eq("id", octAp.id)
    .single();
  assert(round2(apAfter200.balance_due) === 800, `Balance should be 800, got ${apAfter200.balance_due}`);

  await recordApPayment(admin, tenantId, octAp.id, "2026-10-25", 800, contract.business_unit_id);

  await admin.rpc("record_supplier_contract_replacement_payment", {
    p_tenant_id: tenantId,
    p_contract_id: contract.id,
    p_created_by: null,
    p_service_date: "2026-10-20",
    p_replacement_name: "Temp Driver 2",
    p_deduction_amount: 300,
    p_payment_method: "company_cash",
    p_notes: `${tag} replacement 300`,
  });

  const { data: contractAfter } = await admin
    .from("supplier_contracts")
    .select("credit_balance")
    .eq("id", contract.id)
    .single();
  assert(round2(contractAfter.credit_balance) === 300, "Credit should be 300");

  const { data: octApPayments } = await admin
    .from("accounts_payable_payments")
    .select("amount")
    .eq("accounts_payable_id", octAp.id)
    .gte("payment_date", "2026-10-01")
    .lte("payment_date", "2026-10-31");
  const apCashOct = round2(
    (octApPayments ?? []).reduce((s, r) => s + Number(r.amount), 0),
  );
  assert(apCashOct === 1800, `October AP payments expected 1800, got ${apCashOct}`);

  const { data: octReplacements } = await admin
    .from("expense_register")
    .select("amount")
    .eq("tenant_id", tenantId)
    .eq("payment_status", "Paid")
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31")
    .like("notes", `${tag}%`);
  const replacementCash = round2(
    (octReplacements ?? []).reduce((s, r) => s + Number(r.amount), 0),
  );
  assert(replacementCash === 500, `October replacement cash expected 500, got ${replacementCash}`);

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

  const { data: apsNov } = await admin
    .from("accounts_payable")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("source_type", SUPPLIER_CONTRACT_SOURCE_TYPE)
    .eq("source_id", contract.id)
    .eq("invoice_date", "2026-11-01");
  assert((apsNov ?? []).length === 1, "Expected one Nov AP");
  assert(round2(apsNov[0].gross_before_wht) === 1900, `Nov AP should be 1900, got ${apsNov[0].gross_before_wht}`);

  const novAccrualReceipt = buildAccountsPayableAccrualReceiptNo(apsNov[0].id);
  const { data: novAccrual } = await admin
    .from("expense_register")
    .select("gross_before_wht, amount")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", novAccrualReceipt)
    .single();
  assert(
    round2(novAccrual?.gross_before_wht ?? novAccrual?.amount) === 1900,
    "November AP-ACCRUAL should be 1900",
  );

  const { data: apOctFinal } = await admin
    .from("accounts_payable")
    .select("gross_before_wht")
    .eq("id", octAp.id)
    .single();
  assert(round2(apOctFinal.gross_before_wht) === 1800, "October AP unchanged by Nov amendment");

  const manualTag = `${tag}-MANUAL-AP`;
  const { check: octBeforeManual } = await loadBalanceSheetCheck(admin, tenantId, OCT_INDEX);
  const manualTax = computePurchaseTaxAmounts({
    grossBeforeWht: 2000,
    whtRatePct: 0,
    whtAmount: 0,
    inputVatAmount: 0,
  });
  const manualTaxRows = buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: "00000000-0000-4000-8000-000000000002",
    entryDate: "2026-10-01",
    grossBeforeWht: 2000,
    whtRatePct: null,
    whtAmount: 0,
    inputTaxComponent: null,
    inputVatAmount: 0,
    counterpartyName: "Manual control vendor",
    notes: manualTag,
  });
  const { data: manualApCreate, error: manualApErr } = await admin.rpc("save_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: null,
    p_business_unit_id: null,
    p_vendor_name: "Manual control vendor",
    p_invoice_number: `${manualTag}-INV`,
    p_expense_category: category,
    p_sub_category: subCategory,
    p_description: manualTag,
    p_invoice_date: "2026-10-01",
    p_due_date: "2026-10-31",
    p_amount: manualTax.netOfTaxAmount,
    p_amount_paid: 0,
    p_balance_due: manualTax.netOfTaxAmount,
    p_status: "Outstanding",
    p_gross_before_wht: 2000,
    p_wht_rate: null,
    p_wht_amount: 0,
    p_input_vat_amount: 0,
    p_net_of_tax_amount: 2000,
    p_notes: manualTag,
    p_source_type: null,
    p_tax_rows: manualTaxRows,
  });
  assert(!manualApErr && manualApCreate?.id, manualApErr?.message ?? "manual AP create failed");
  const { check: octAfterManual } = await loadBalanceSheetCheck(admin, tenantId, OCT_INDEX);
  assert(
    Math.abs(octAfterManual.difference - octBeforeManual.difference) <= 0.02,
    `Manual AP shifted Oct BS diff from ${octBeforeManual.difference} to ${octAfterManual.difference}`,
  );
  await admin.rpc("delete_accounts_payable", {
    p_tenant_id: tenantId,
    p_ap_id: manualApCreate.id,
  });
  console.log("PASS: manual AP control (Oct BS diff unchanged)");

  await assertBalanceSheetBalanced(
    admin,
    tenantId,
    OCT_INDEX,
    "October 2026 (final)",
    octBsBaseline.difference,
  );
  await assertBalanceSheetBalanced(
    admin,
    tenantId,
    NOV_INDEX,
    "November 2026",
    novBsBaseline.difference,
  );

  await runApRegression(admin, tenantId, pgClient);

  await proveDirectApDeleteTrigger(admin, pgClient, tenantId, octBsBaseline.difference);

  const { check: octAfterScenario } = await loadBalanceSheetCheck(admin, tenantId, OCT_INDEX);
  const { check: novAfterScenario } = await loadBalanceSheetCheck(admin, tenantId, NOV_INDEX);
  assert(
    Math.abs(octAfterScenario.difference - octBsBaseline.difference) <= 0.02,
    `Post-scenario Oct BS diff ${octAfterScenario.difference} != baseline ${octBsBaseline.difference}`,
  );
  assert(
    Math.abs(novAfterScenario.difference - novBsBaseline.difference) <= 0.02,
    `Post-scenario Nov BS diff ${novAfterScenario.difference} != baseline ${novBsBaseline.difference}`,
  );

  console.log("PASS: supplier contracts staging scenario (all assertions)");
  } finally {
    await cleanupSupplierContractTestData(admin, tenantId, {
      tag,
      contractId: contract?.id,
      supplierId: supplier?.id,
    });
    const { check: octFinal } = await loadBalanceSheetCheck(admin, tenantId, OCT_INDEX);
    const { check: novFinal } = await loadBalanceSheetCheck(admin, tenantId, NOV_INDEX);
    console.log(
      `Cleanup BS check: Oct diff=${octFinal.difference} (baseline ${octBsBaseline.difference}) Nov diff=${novFinal.difference} (baseline ${novBsBaseline.difference})`,
    );
    if (
      Math.abs(octFinal.difference - octBsBaseline.difference) > 0.02 ||
      Math.abs(novFinal.difference - novBsBaseline.difference) > 0.02
    ) {
      throw new Error("Cleanup did not restore BS baseline");
    }
    console.log("Cleanup done.");
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
