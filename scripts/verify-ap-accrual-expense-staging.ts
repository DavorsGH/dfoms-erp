/**
 * Staging: AP accrual expense auto-post — dual-tenant (Davors + Caanta).
 *
 * Verifies:
 *  1. Operating AP (no tax) posts AP-ACCRUAL-* expense; BS difference unchanged
 *  2. Operating AP with WHT+VAT posts accrual + tax legs; BS difference unchanged
 *  3. Full company_cash pay via accounts_payable_payments drops cash; BS still unchanged
 *  4. Delete reverses accrual + AP; BS back to baseline
 *  5. Fixed Asset credit AP and statutory AP do NOT get an accrual row
 *
 * Usage: npx tsx scripts/verify-ap-accrual-expense-staging.ts
 * Staging only. Does not touch production. Does not commit.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildAccountsPayableAccrualReceiptNo,
  deleteAccountsPayableAccrualExpense,
  postAccountsPayableAccrualExpense,
} from "../app/dashboard/finance/accounts-payable-accrual-utils";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { computePurchaseTaxAmounts } from "../app/dashboard/finance/tax-utils";
import {
  deleteTaxLedgerEntriesForSource,
  syncPurchaseTaxLedger,
} from "../app/dashboard/finance/tax-ledger-sync";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { InventoryBalanceConfig } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import type { PayrollHistoryWagesEntry } from "../app/dashboard/finance/accrued-wages-utils";
import { PAYROLL_PAYABLE_CATEGORY_SSNIT } from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";

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

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const YEAR = 2026;
const MONTH_INDEX = 7; // August
const INVOICE_DATE = "2026-08-15";
const DUE_DATE = "2026-09-14";
const PAYMENT_DATE = "2026-08-20";
const RUN_ID = Date.now();

const TENANTS = [
  { id: DAVORS, name: "Davors" },
  { id: CAANTA, name: "Caanta" },
] as const;

async function fetchPayrollHistoryWages(
  admin: SupabaseClient,
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
  if (fallback.error) {
    throw new Error(`payroll_history: ${fallback.error.message}`);
  }
  return (
    (fallback.data as Array<{ payroll_month: string; net_pay: number }> | null) ??
    []
  ).map((row) => ({
    payroll_month: row.payroll_month,
    net_pay: row.net_pay,
    net_only_adjustment: 0,
  }));
}

async function loadSnapshot(admin: SupabaseClient, tenantId: string) {
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
    { data: apPayments, error: apPayError },
    livePayrollBundle,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", tenantId)
      .order("date"),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", tenantId)
      .order("date"),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", tenantId)
      .order("asset_id"),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category, source_type",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", tenantId),
    admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("period_month"),
    admin.from("payroll_processing").select("*").eq("tenant_id", tenantId),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
      .eq("tenant_id", tenantId),
    admin
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", tenantId),
    admin
      .from("product_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", tenantId),
    admin
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status")
      .eq("tenant_id", tenantId)
      .eq("status", "open")
      .order("entry_date"),
    admin
      .from("accounts_payable_payments")
      .select("tenant_id, payment_date, amount, payment_source")
      .eq("tenant_id", tenantId),
    fetchPayrollLiveRecalcBundle(admin, { tenantId }),
  ]);

  for (const [label, err] of [
    ["income", incomeError],
    ["expense", expenseError],
    ["fa", faError],
    ["ap", apError],
    ["capital", capitalError],
    ["manual", manualError],
    ["tax", taxError],
    ["apPayments", apPayError],
  ] as const) {
    if (err) throw new Error(`${label}: ${err.message}`);
  }

  const payrollHistory = await fetchPayrollHistoryWages(admin, tenantId);
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
    {
      tenantId,
      accountsPayablePayments: (apPayments ?? []).map((p) => ({
        tenant_id: p.tenant_id,
        payment_date: p.payment_date,
        amount: Number(p.amount) || 0,
        payment_source: p.payment_source as "company_cash" | "directors_loan",
      })),
    },
  );

  const check = getBalanceCheckForPeriod(bs, MONTH_INDEX);
  return {
    cash: rowAmount(bs, "cash", MONTH_INDEX),
    ap: rowAmount(bs, "accounts-payable", MONTH_INDEX),
    bsDiff: check.difference,
    bsBalanced: check.isBalanced,
  };
}

async function findAccrual(
  admin: SupabaseClient,
  tenantId: string,
  apId: string,
) {
  const receiptNo = buildAccountsPayableAccrualReceiptNo(apId);
  const { data, error } = await admin
    .from("expense_register")
    .select(
      "id, receipt_no, amount, net_of_tax_amount, payment_status, expense_category",
    )
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();
  if (error) throw new Error(`accrual lookup: ${error.message}`);
  return data;
}

async function cleanupAp(
  admin: SupabaseClient,
  tenantId: string,
  apId: string,
) {
  await admin
    .from("accounts_payable_payments")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("accounts_payable_id", apId);
  await deleteAccountsPayableAccrualExpense(admin, apId, { tenantId });
  await deleteTaxLedgerEntriesForSource(admin, "accounts_payable", apId);
  const { error } = await admin
    .from("accounts_payable")
    .delete()
    .eq("id", apId)
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`cleanup AP ${apId}: ${error.message}`);
}

async function runTenant(
  admin: SupabaseClient,
  tenant: { id: string; name: string },
) {
  const marker = `AP-ACCRUAL-TEST-${tenant.name}-${RUN_ID}`;
  const createdIds: string[] = [];
  console.log(`\n========== ${tenant.name} (${tenant.id}) ==========`);

  try {
    const baseline = await loadSnapshot(admin, tenant.id);
    console.log(
      "baseline:",
      JSON.stringify({
        cash: baseline.cash,
        ap: baseline.ap,
        bsDiff: baseline.bsDiff,
        bsBalanced: baseline.bsBalanced,
      }),
    );

    // --- 1) Operating AP, no tax ---
    const noTaxGross = 1700;
    const { data: noTaxAp, error: noTaxErr } = await admin
      .from("accounts_payable")
      .insert({
        tenant_id: tenant.id,
        vendor_name: `${marker} NoTax Vendor`,
        invoice_number: `${marker}-NOTAX`,
        expense_category: "Direct Operational",
        sub_category: "Transportation",
        description: "Staging AP accrual no-tax test",
        invoice_date: INVOICE_DATE,
        due_date: DUE_DATE,
        amount: noTaxGross,
        amount_paid: 0,
        balance_due: noTaxGross,
        status: "Outstanding",
        gross_before_wht: noTaxGross,
        wht_amount: 0,
        input_vat_amount: 0,
        net_of_tax_amount: noTaxGross,
        notes: marker,
      })
      .select("id")
      .single();
    assert(!noTaxErr && noTaxAp, noTaxErr?.message ?? "no-tax AP insert failed");
    const noTaxId = (noTaxAp as { id: string }).id;
    createdIds.push(noTaxId);

    const noTaxPost = await postAccountsPayableAccrualExpense(
      admin,
      {
        id: noTaxId,
        vendor_name: `${marker} NoTax Vendor`,
        invoice_number: `${marker}-NOTAX`,
        expense_category: "Direct Operational",
        sub_category: "Transportation",
        invoice_date: INVOICE_DATE,
        due_date: DUE_DATE,
        amount: noTaxGross,
        net_of_tax_amount: noTaxGross,
        gross_before_wht: noTaxGross,
        wht_amount: 0,
        input_vat_amount: 0,
        business_unit_id: null,
      },
      { tenantId: tenant.id },
    );
    assert(
      noTaxPost.status === "inserted" || noTaxPost.status === "updated",
      `no-tax accrual post unexpected: ${JSON.stringify(noTaxPost)}`,
    );

    const noTaxAccrual = await findAccrual(admin, tenant.id, noTaxId);
    assert(noTaxAccrual, "no-tax accrual expense missing");
    assert(
      Number(noTaxAccrual.amount) === noTaxGross,
      `no-tax accrual amount ${noTaxAccrual.amount}`,
    );
    assert(
      Number(noTaxAccrual.net_of_tax_amount) === noTaxGross,
      `no-tax accrual net_of_tax ${noTaxAccrual.net_of_tax_amount}`,
    );
    assert(
      noTaxAccrual.payment_status === "Accrued - Not Yet Paid",
      `no-tax payment_status ${noTaxAccrual.payment_status}`,
    );

    const afterNoTax = await loadSnapshot(admin, tenant.id);
    assert(
      Math.abs(afterNoTax.bsDiff - baseline.bsDiff) < 0.01,
      `no-tax AP opened BS gap: baseline=${baseline.bsDiff} after=${afterNoTax.bsDiff}`,
    );
    console.log(
      "[PASS] no-tax operating AP: accrual posted, BS delta",
      round2(afterNoTax.bsDiff - baseline.bsDiff),
    );

    // --- 2) Operating AP with WHT + input VAT ---
    const taxGross = 1170;
    const taxWht = 70;
    const taxVat = 170;
    const purchaseTax = computePurchaseTaxAmounts({
      grossBeforeWht: taxGross,
      whtRatePct: 5,
      whtAmount: taxWht,
      inputVatAmount: taxVat,
    });
    assert(
      purchaseTax.netPaidToSupplier === 1100 &&
        purchaseTax.netOfTaxAmount === 1000,
      `unexpected tax math: ${JSON.stringify(purchaseTax)}`,
    );

    const { data: taxAp, error: taxErr } = await admin
      .from("accounts_payable")
      .insert({
        tenant_id: tenant.id,
        vendor_name: `${marker} Tax Vendor`,
        invoice_number: `${marker}-TAX`,
        expense_category: "Administrative",
        sub_category: "Office Supplies",
        description: "Staging AP accrual WHT+VAT test",
        invoice_date: INVOICE_DATE,
        due_date: DUE_DATE,
        amount: purchaseTax.netPaidToSupplier,
        amount_paid: 0,
        balance_due: purchaseTax.netPaidToSupplier,
        status: "Outstanding",
        gross_before_wht: purchaseTax.grossBeforeWht,
        wht_rate: 5,
        wht_amount: purchaseTax.whtAmount,
        input_vat_amount: purchaseTax.inputVatAmount,
        net_of_tax_amount: purchaseTax.netOfTaxAmount,
        notes: marker,
      })
      .select("id")
      .single();
    assert(!taxErr && taxAp, taxErr?.message ?? "tax AP insert failed");
    const taxId = (taxAp as { id: string }).id;
    createdIds.push(taxId);

    const taxPost = await postAccountsPayableAccrualExpense(
      admin,
      {
        id: taxId,
        vendor_name: `${marker} Tax Vendor`,
        invoice_number: `${marker}-TAX`,
        expense_category: "Administrative",
        sub_category: "Office Supplies",
        invoice_date: INVOICE_DATE,
        due_date: DUE_DATE,
        amount: purchaseTax.netPaidToSupplier,
        net_of_tax_amount: purchaseTax.netOfTaxAmount,
        gross_before_wht: purchaseTax.grossBeforeWht,
        wht_rate: 5,
        wht_amount: purchaseTax.whtAmount,
        input_vat_amount: purchaseTax.inputVatAmount,
        business_unit_id: null,
      },
      { tenantId: tenant.id },
    );
    assert(
      taxPost.status === "inserted" || taxPost.status === "updated",
      `tax accrual post unexpected: ${JSON.stringify(taxPost)}`,
    );

    const { error: ledgerError } = await syncPurchaseTaxLedger(admin, {
      sourceType: "accounts_payable",
      sourceId: taxId,
      entryDate: INVOICE_DATE,
      grossBeforeWht: purchaseTax.grossBeforeWht,
      whtRatePct: 5,
      whtAmount: purchaseTax.whtAmount,
      inputTaxComponent: purchaseTax.inputTaxComponent,
      inputTaxRatePct: null,
      inputVatAmount: purchaseTax.inputVatAmount,
      counterpartyName: `${marker} Tax Vendor`,
      notes: `Invoice ${marker}-TAX`,
      tenantId: tenant.id,
    });
    assert(!ledgerError, `tax ledger sync: ${ledgerError}`);

    const taxAccrual = await findAccrual(admin, tenant.id, taxId);
    assert(taxAccrual, "tax accrual expense missing");
    assert(
      Number(taxAccrual.amount) === purchaseTax.netPaidToSupplier,
      `tax accrual amount ${taxAccrual.amount}`,
    );
    assert(
      Number(taxAccrual.net_of_tax_amount) === purchaseTax.netOfTaxAmount,
      `tax accrual net_of_tax ${taxAccrual.net_of_tax_amount}`,
    );

    // Accrual must NOT own tax_ledger rows
    const { data: expenseTaxLegs, error: expTaxErr } = await admin
      .from("tax_ledger_entries")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("source_type", "expense_register")
      .eq("source_id", taxAccrual.id);
    assert(!expTaxErr, expTaxErr?.message ?? "expense tax lookup failed");
    assert(
      (expenseTaxLegs?.length ?? 0) === 0,
      "accrual expense must not own tax_ledger rows",
    );

    const afterTax = await loadSnapshot(admin, tenant.id);
    assert(
      Math.abs(afterTax.bsDiff - baseline.bsDiff) < 0.01,
      `tax AP opened BS gap: baseline=${baseline.bsDiff} after=${afterTax.bsDiff}`,
    );
    console.log(
      "[PASS] WHT+VAT operating AP: accrual+tax posted, BS delta",
      round2(afterTax.bsDiff - baseline.bsDiff),
    );

    // --- 3) Full company_cash payment (tax AP) ---
    const payAmount = purchaseTax.netPaidToSupplier;
    const { error: payErr } = await admin.from("accounts_payable_payments").insert({
      tenant_id: tenant.id,
      accounts_payable_id: taxId,
      payment_date: PAYMENT_DATE,
      amount: payAmount,
      payment_source: "company_cash",
      notes: `${marker} full pay`,
    });
    assert(!payErr, payErr?.message ?? "payment insert failed");

    const { error: recomputeErr } = await admin.rpc(
      "recompute_accounts_payable_from_payments",
      { p_ap_id: taxId },
    );
    assert(!recomputeErr, recomputeErr?.message ?? "recompute failed");

    const accrualAfterPay = await findAccrual(admin, tenant.id, taxId);
    assert(accrualAfterPay, "accrual should still exist after payment");
    assert(
      Number(accrualAfterPay.amount) === payAmount,
      "payment must not change accrual amount",
    );
    assert(
      accrualAfterPay.payment_status === "Accrued - Not Yet Paid",
      `payment must not flip accrual status (got ${accrualAfterPay.payment_status})`,
    );

    const afterPay = await loadSnapshot(admin, tenant.id);
    assert(
      Math.abs(afterPay.cash - afterTax.cash + payAmount) < 0.01,
      `cash should drop by ${payAmount}, got delta ${afterPay.cash - afterTax.cash}`,
    );
    assert(
      Math.abs(afterPay.bsDiff - baseline.bsDiff) < 0.01,
      `pay opened BS gap: baseline=${baseline.bsDiff} after=${afterPay.bsDiff}`,
    );
    console.log(
      "[PASS] full company_cash pay: cash↓",
      payAmount,
      "BS delta",
      round2(afterPay.bsDiff - baseline.bsDiff),
    );

    // --- 4) Delete tax AP (accrual + AP gone; BS back) ---
    await cleanupAp(admin, tenant.id, taxId);
    createdIds.splice(createdIds.indexOf(taxId), 1);

    assert(
      !(await findAccrual(admin, tenant.id, taxId)),
      "tax accrual should be gone after delete",
    );
    const afterTaxDelete = await loadSnapshot(admin, tenant.id);
    // Still have no-tax AP outstanding — BS should match afterNoTax (not full baseline)
    assert(
      Math.abs(afterTaxDelete.bsDiff - afterNoTax.bsDiff) < 0.01,
      `after tax-AP delete BS=${afterTaxDelete.bsDiff} expected~${afterNoTax.bsDiff}`,
    );
    console.log("[PASS] tax AP delete: accrual+AP gone, BS matches no-tax-only state");

    // Delete no-tax AP → full baseline
    await cleanupAp(admin, tenant.id, noTaxId);
    createdIds.splice(createdIds.indexOf(noTaxId), 1);
    assert(
      !(await findAccrual(admin, tenant.id, noTaxId)),
      "no-tax accrual should be gone after delete",
    );
    const afterAllDelete = await loadSnapshot(admin, tenant.id);
    assert(
      Math.abs(afterAllDelete.bsDiff - baseline.bsDiff) < 0.01,
      `after full cleanup BS=${afterAllDelete.bsDiff} baseline=${baseline.bsDiff}`,
    );
    assert(
      Math.abs(afterAllDelete.cash - baseline.cash) < 0.01,
      `cash not restored: ${afterAllDelete.cash} vs ${baseline.cash}`,
    );
    console.log(
      "[PASS] full cleanup: BS delta",
      round2(afterAllDelete.bsDiff - baseline.bsDiff),
      "cash restored",
    );

    // --- 5) Fixed Asset credit AP — no accrual ---
    const { data: faAp, error: faErr } = await admin
      .from("accounts_payable")
      .insert({
        tenant_id: tenant.id,
        vendor_name: `${marker} FA Vendor`,
        invoice_number: `FAP-TEST${String(RUN_ID).slice(-6)}`,
        expense_category: "Fixed Assets",
        sub_category: "Fixed Asset Purchases",
        description: "Staging FA credit AP — must not accrue expense",
        invoice_date: INVOICE_DATE,
        due_date: DUE_DATE,
        amount: 5000,
        amount_paid: 0,
        balance_due: 5000,
        status: "Outstanding",
        source_type: "fixed_asset",
        source_id: `TEST-ASSET-${RUN_ID}`,
        notes: marker,
      })
      .select("id")
      .single();
    assert(!faErr && faAp, faErr?.message ?? "FA AP insert failed");
    const faId = (faAp as { id: string }).id;
    createdIds.push(faId);

    const faPost = await postAccountsPayableAccrualExpense(
      admin,
      {
        id: faId,
        vendor_name: `${marker} FA Vendor`,
        invoice_number: `FAP-TEST${String(RUN_ID).slice(-6)}`,
        expense_category: "Fixed Assets",
        sub_category: "Fixed Asset Purchases",
        invoice_date: INVOICE_DATE,
        amount: 5000,
        net_of_tax_amount: 5000,
        source_type: "fixed_asset",
      },
      { tenantId: tenant.id },
    );
    assert(
      faPost.status === "skipped" && faPost.reason === "fixed_asset_credit",
      `FA post expected skip, got ${JSON.stringify(faPost)}`,
    );
    assert(!(await findAccrual(admin, tenant.id, faId)), "FA AP must not have accrual");
    await cleanupAp(admin, tenant.id, faId);
    createdIds.pop();
    console.log("[PASS] Fixed Asset credit AP: no accrual row");

    // --- 6) Statutory remittance AP — no accrual ---
    const { data: statAp, error: statErr } = await admin
      .from("accounts_payable")
      .insert({
        tenant_id: tenant.id,
        vendor_name: "SSNIT",
        invoice_number: `PAYROLL-SSNIT-${marker}`,
        expense_category: PAYROLL_PAYABLE_CATEGORY_SSNIT,
        sub_category: "Payroll",
        description: "Staging statutory AP — must not accrue operating expense",
        invoice_date: INVOICE_DATE,
        due_date: DUE_DATE,
        amount: 300,
        amount_paid: 0,
        balance_due: 300,
        status: "Outstanding",
        notes: marker,
      })
      .select("id")
      .single();
    assert(!statErr && statAp, statErr?.message ?? "statutory AP insert failed");
    const statId = (statAp as { id: string }).id;
    createdIds.push(statId);

    const statPost = await postAccountsPayableAccrualExpense(
      admin,
      {
        id: statId,
        vendor_name: "SSNIT",
        invoice_number: `PAYROLL-SSNIT-${marker}`,
        expense_category: PAYROLL_PAYABLE_CATEGORY_SSNIT,
        sub_category: "Payroll",
        invoice_date: INVOICE_DATE,
        amount: 300,
        net_of_tax_amount: 300,
      },
      { tenantId: tenant.id },
    );
    assert(
      statPost.status === "skipped" && statPost.reason === "statutory_remittance",
      `statutory post expected skip, got ${JSON.stringify(statPost)}`,
    );
    assert(
      !(await findAccrual(admin, tenant.id, statId)),
      "statutory AP must not have accrual",
    );
    await cleanupAp(admin, tenant.id, statId);
    createdIds.pop();
    console.log("[PASS] statutory remittance AP: no accrual row");

    console.log(`\nPASS: ${tenant.name} AP accrual expense verification complete.`);
  } finally {
    for (const id of [...createdIds].reverse()) {
      try {
        await cleanupAp(admin, tenant.id, id);
        console.log(`cleanup leftover AP ${id}`);
      } catch (cleanupError) {
        console.error(
          `CLEANUP FAILED for ${id}:`,
          cleanupError instanceof Error ? cleanupError.message : cleanupError,
        );
      }
    }
  }
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

  for (const tenant of TENANTS) {
    await runTenant(admin, tenant);
  }

  console.log("\n========== ALL TENANTS PASSED ==========");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
