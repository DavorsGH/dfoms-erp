/**
 * Staging smoke test: Expense Register + Fixed Assets vendor/WHT-VAT pipelines.
 *
 * Prerequisites:
 *   - Migration 234 applied on staging (approved_by + tax columns on fixed_assets)
 *   - App code with vendor dropdown + WHT checkbox wiring
 *
 * Usage:
 *   npx tsx scripts/_test-expense-fixed-asset-vendor-tax-staging.ts
 *
 * Creates probe rows for Davors tenant, verifies tax_ledger_entries, then deletes them.
 * Also runs a BS integrity check for Aug 2026 after Fixed Asset with WHT.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  FULL_YEAR_INDEX,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  computePurchaseTaxAmounts,
  roundTaxAmount,
} from "../app/dashboard/finance/tax-utils";
import {
  deleteTaxLedgerEntriesForSource,
  syncPurchaseTaxLedger,
} from "../app/dashboard/finance/tax-ledger-sync";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const TAG = `vendor-tax-probe-${Date.now()}`;

function loadEnvForce(filePath: string) {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function countTaxRows(
  admin: SupabaseClient,
  sourceType: string,
  sourceId: string,
) {
  const { count, error } = await admin
    .from("tax_ledger_entries")
    .select("id", { count: "exact", head: true })
    .eq("source_type", sourceType)
    .eq("source_id", sourceId);
  if (error) throw error;
  return count ?? 0;
}

async function pickSupplier(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("suppliers")
    .select("id, name")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("is_active", true)
    .order("name")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  assert(data?.name, "No active supplier for Davors tenant — seed one first");
  return data as { id: string; name: string };
}

async function pickApproverName(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("approvers")
    .select("employees!approvers_employee_id_fkey(full_name)")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const emp = data?.employees as { full_name?: string } | { full_name?: string }[] | null;
  const name = Array.isArray(emp) ? emp[0]?.full_name : emp?.full_name;
  return name?.trim() || "System";
}

async function pickExpenseCategory(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("expense_categories")
    .select("name")
    .order("name")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.name ?? "Office Expenses";
}

async function pickAssetCategory(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("asset_categories")
    .select("name")
    .order("name")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.name ?? "Equipment";
}

async function nextAssetId(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: DAVORS_TENANT_ID,
    p_entity_type: "ASSET",
    p_padding: 4,
  });
  if (error || !data) {
    throw new Error(`generate_next_code ASSET failed: ${error?.message ?? "empty"}`);
  }
  return String(data);
}

async function nextExpenseReceipt(admin: SupabaseClient) {
  const { data, error } = await admin.rpc("generate_next_code", {
    p_tenant_id: DAVORS_TENANT_ID,
    p_entity_type: "EXP",
    p_padding: 4,
  });
  if (!error && data) return String(data);
  return `EXP-PROBE-${Date.now()}`;
}

async function runBsCheck(admin: SupabaseClient) {
  const data = await fetchBalanceSheetPageData(admin, DAVORS_TENANT_ID);
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
      tenantId: DAVORS_TENANT_ID,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  return getBalanceCheckForPeriod(report, FULL_YEAR_INDEX);
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ref ${STAGING_REF}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Confirm migration 234 columns exist
  const { error: colProbe } = await admin
    .from("fixed_assets")
    .select("approved_by, wht_rate, wht_amount, input_vat_amount, net_of_tax_amount, vendor_name")
    .limit(1);
  assert(
    !colProbe,
    `fixed_assets tax/approval columns missing — apply migration 234 first: ${colProbe?.message}`,
  );

  const supplier = await pickSupplier(admin);
  const approver = await pickApproverName(admin);
  const expenseCategory = await pickExpenseCategory(admin);
  const assetCategory = await pickAssetCategory(admin);
  const today = new Date().toISOString().slice(0, 10);

  const createdExpenseIds: string[] = [];
  const createdAssetIds: string[] = [];

  console.log("\n=== Expense Register + Fixed Assets staging probe ===\n");
  console.log("Supplier:", supplier.name);
  console.log("Approver:", approver);

  try {
    // --- Expense A: checkbox off, vendor from dropdown ---
    {
      const receipt = await nextExpenseReceipt(admin);
      const purchaseTax = computePurchaseTaxAmounts({
        grossBeforeWht: 100,
        whtRatePct: 0,
        whtAmount: 0,
        inputVatAmount: 0,
      });
      const { data, error } = await admin
        .from("expense_register")
        .insert({
          tenant_id: DAVORS_TENANT_ID,
          date: today,
          expense_category: expenseCategory,
          sub_category: null,
          description: `${TAG}-exp-no-tax`,
          vendor: supplier.name,
          price: 100,
          quantity: 1,
          amount: purchaseTax.netPaidToSupplier,
          payment_method: "Cash",
          payment_status: "Paid",
          approved_by: approver,
          receipt_no: receipt,
          notes: TAG,
          gross_before_wht: purchaseTax.grossBeforeWht,
          wht_rate: null,
          wht_amount: 0,
          input_vat_amount: 0,
          net_of_tax_amount: purchaseTax.netOfTaxAmount,
        })
        .select("id")
        .single();
      assert(!error && data, `Expense A insert failed: ${error?.message}`);
      createdExpenseIds.push(data!.id);
      const { error: ledgerError } = await syncPurchaseTaxLedger(admin, {
        sourceType: "expense_register",
        sourceId: data!.id,
        entryDate: today,
        grossBeforeWht: purchaseTax.grossBeforeWht,
        whtRatePct: null,
        whtAmount: 0,
        inputTaxComponent: null,
        inputTaxRatePct: null,
        inputVatAmount: 0,
        counterpartyName: supplier.name,
        tenantId: DAVORS_TENANT_ID,
      });
      assert(!ledgerError, `Expense A ledger: ${ledgerError}`);
      const taxCount = await countTaxRows(admin, "expense_register", data!.id);
      console.log(
        `[PASS] Expense A (dropdown vendor, no tax): id=${data!.id} vendor=${supplier.name} tax_rows=${taxCount}`,
      );
      assert(taxCount === 0, "Expense A should create zero tax_ledger_entries");
    }

    // --- Expense B: Other vendor ---
    {
      const receipt = await nextExpenseReceipt(admin);
      const otherVendor = `One-Time Vendor ${TAG}`;
      const purchaseTax = computePurchaseTaxAmounts({
        grossBeforeWht: 50,
        whtRatePct: 0,
        whtAmount: 0,
        inputVatAmount: 0,
      });
      const { data, error } = await admin
        .from("expense_register")
        .insert({
          tenant_id: DAVORS_TENANT_ID,
          date: today,
          expense_category: expenseCategory,
          description: `${TAG}-exp-other-vendor`,
          vendor: otherVendor,
          price: 50,
          quantity: 1,
          amount: purchaseTax.netPaidToSupplier,
          payment_method: "Cash",
          payment_status: "Paid",
          approved_by: approver,
          receipt_no: receipt,
          notes: TAG,
          gross_before_wht: purchaseTax.grossBeforeWht,
          wht_rate: null,
          wht_amount: 0,
          input_vat_amount: 0,
          net_of_tax_amount: purchaseTax.netOfTaxAmount,
        })
        .select("id, vendor")
        .single();
      assert(!error && data, `Expense B insert failed: ${error?.message}`);
      createdExpenseIds.push(data!.id);
      console.log(
        `[PASS] Expense B (Other vendor): id=${data!.id} vendor=${data!.vendor}`,
      );
      assert(data!.vendor === otherVendor, "Other vendor name not stored");
    }

    // --- Expense C: WHT/VAT on ---
    {
      const receipt = await nextExpenseReceipt(admin);
      const gross = 1000;
      const whtRate = 7.5;
      const whtAmount = roundTaxAmount(gross * (whtRate / 100));
      const inputVat = 150;
      const purchaseTax = computePurchaseTaxAmounts({
        grossBeforeWht: gross,
        whtRatePct: whtRate,
        whtAmount,
        inputVatAmount: inputVat,
      });
      const { data, error } = await admin
        .from("expense_register")
        .insert({
          tenant_id: DAVORS_TENANT_ID,
          date: today,
          expense_category: expenseCategory,
          description: `${TAG}-exp-with-tax`,
          vendor: supplier.name,
          price: gross,
          quantity: 1,
          amount: purchaseTax.netPaidToSupplier,
          payment_method: "Cash",
          payment_status: "Paid",
          approved_by: approver,
          receipt_no: receipt,
          notes: TAG,
          gross_before_wht: purchaseTax.grossBeforeWht,
          wht_rate: whtRate,
          wht_amount: purchaseTax.whtAmount,
          input_vat_amount: purchaseTax.inputVatAmount,
          net_of_tax_amount: purchaseTax.netOfTaxAmount,
        })
        .select("id")
        .single();
      assert(!error && data, `Expense C insert failed: ${error?.message}`);
      createdExpenseIds.push(data!.id);
      const { error: ledgerError } = await syncPurchaseTaxLedger(admin, {
        sourceType: "expense_register",
        sourceId: data!.id,
        entryDate: today,
        grossBeforeWht: purchaseTax.grossBeforeWht,
        whtRatePct: whtRate,
        whtAmount: purchaseTax.whtAmount,
        inputTaxComponent: purchaseTax.inputTaxComponent,
        inputTaxRatePct: null,
        inputVatAmount: purchaseTax.inputVatAmount,
        counterpartyName: supplier.name,
        tenantId: DAVORS_TENANT_ID,
      });
      assert(!ledgerError, `Expense C ledger: ${ledgerError}`);
      const taxCount = await countTaxRows(admin, "expense_register", data!.id);
      console.log(
        `[PASS] Expense C (WHT/VAT on): id=${data!.id} tax_rows=${taxCount} (expect 2: wht + input vat)`,
      );
      assert(taxCount === 2, `Expense C expected 2 tax rows, got ${taxCount}`);
    }

    // --- Fixed Asset A: no tax, vendor + approver ---
    {
      const assetId = await nextAssetId(admin);
      const purchaseTax = computePurchaseTaxAmounts({
        grossBeforeWht: 5000,
        whtRatePct: 0,
        whtAmount: 0,
        inputVatAmount: 0,
      });
      const { data, error } = await admin
        .from("fixed_assets")
        .insert({
          tenant_id: DAVORS_TENANT_ID,
          asset_id: assetId,
          asset_name: `${TAG}-fa-no-tax`,
          asset_category: assetCategory,
          purchase_date: today,
          original_cost: 5000,
          quantity: 1,
          total_cost: 5000,
          useful_life_years: 5,
          depreciation_method: "Straight Line",
          annual_depreciation: 1000,
          location: "HQ",
          notes: TAG,
          payment_method: "Cash",
          vendor_name: supplier.name,
          approved_by: approver,
          gross_before_wht: purchaseTax.grossBeforeWht,
          wht_rate: null,
          wht_amount: 0,
          input_vat_amount: 0,
          net_of_tax_amount: purchaseTax.netOfTaxAmount,
        })
        .select("asset_id, vendor_name, approved_by")
        .single();
      assert(!error && data, `Fixed Asset A insert failed: ${error?.message}`);
      createdAssetIds.push(data!.asset_id);
      const { error: ledgerError } = await syncPurchaseTaxLedger(admin, {
        sourceType: "fixed_asset",
        sourceId: data!.asset_id,
        entryDate: today,
        grossBeforeWht: purchaseTax.grossBeforeWht,
        whtRatePct: null,
        whtAmount: 0,
        inputTaxComponent: null,
        inputTaxRatePct: null,
        inputVatAmount: 0,
        counterpartyName: supplier.name,
        tenantId: DAVORS_TENANT_ID,
      });
      assert(!ledgerError, `FA A ledger: ${ledgerError}`);
      const taxCount = await countTaxRows(admin, "fixed_asset", data!.asset_id);
      console.log(
        `[PASS] Fixed Asset A (no tax): id=${data!.asset_id} vendor=${data!.vendor_name} approver=${data!.approved_by} tax_rows=${taxCount}`,
      );
      assert(taxCount === 0, "FA A should create zero tax rows");
      assert(data!.vendor_name === supplier.name, "vendor_name mismatch");
      assert(data!.approved_by === approver, "approved_by mismatch");
    }

    // --- Fixed Asset B: WHT/VAT on + BS check (delta vs baseline) ---
    {
      const bsBefore = await runBsCheck(admin);
      console.log(
        `[BS before FA+tax] balanced=${bsBefore.isBalanced} delta=${bsBefore.difference}`,
      );

      const assetId = await nextAssetId(admin);
      const gross = 10000;
      const whtRate = 7.5;
      const whtAmount = roundTaxAmount(gross * (whtRate / 100));
      const inputVat = 1220;
      const purchaseTax = computePurchaseTaxAmounts({
        grossBeforeWht: gross,
        whtRatePct: whtRate,
        whtAmount,
        inputVatAmount: inputVat,
      });
      const { data, error } = await admin
        .from("fixed_assets")
        .insert({
          tenant_id: DAVORS_TENANT_ID,
          asset_id: assetId,
          asset_name: `${TAG}-fa-with-tax`,
          asset_category: assetCategory,
          purchase_date: today,
          original_cost: gross,
          quantity: 1,
          total_cost: gross,
          useful_life_years: 5,
          depreciation_method: "Straight Line",
          annual_depreciation: gross / 5,
          location: "HQ",
          notes: TAG,
          payment_method: "Cash",
          vendor_name: supplier.name,
          approved_by: approver,
          gross_before_wht: purchaseTax.grossBeforeWht,
          wht_rate: whtRate,
          wht_amount: purchaseTax.whtAmount,
          input_vat_amount: purchaseTax.inputVatAmount,
          net_of_tax_amount: purchaseTax.netOfTaxAmount,
        })
        .select("asset_id")
        .single();
      assert(!error && data, `Fixed Asset B insert failed: ${error?.message}`);
      createdAssetIds.push(data!.asset_id);
      const { error: ledgerError } = await syncPurchaseTaxLedger(admin, {
        sourceType: "fixed_asset",
        sourceId: data!.asset_id,
        entryDate: today,
        grossBeforeWht: purchaseTax.grossBeforeWht,
        whtRatePct: whtRate,
        whtAmount: purchaseTax.whtAmount,
        inputTaxComponent: purchaseTax.inputTaxComponent,
        inputTaxRatePct: null,
        inputVatAmount: purchaseTax.inputVatAmount,
        counterpartyName: supplier.name,
        tenantId: DAVORS_TENANT_ID,
      });
      assert(!ledgerError, `FA B ledger: ${ledgerError}`);
      const { data: taxRows, error: taxErr } = await admin
        .from("tax_ledger_entries")
        .select("id, source_type, source_id, direction, tax_component, tax_amount")
        .eq("source_type", "fixed_asset")
        .eq("source_id", data!.asset_id);
      assert(!taxErr, taxErr?.message);
      console.log(
        `[PASS] Fixed Asset B (WHT/VAT on): id=${data!.asset_id} tax_rows=${taxRows?.length ?? 0}`,
        taxRows,
      );
      assert(
        (taxRows?.length ?? 0) === 2,
        `FA B expected 2 tax rows, got ${taxRows?.length}`,
      );
      assert(
        taxRows!.every((r) => r.source_id === data!.asset_id),
        "tax rows source_id mismatch",
      );

      const bsAfter = await runBsCheck(admin);
      const deltaShift = Math.round((bsAfter.difference - bsBefore.difference) * 100) / 100;
      console.log(
        `[BS after FA+tax] balanced=${bsAfter.isBalanced} assets=${bsAfter.totalAssets} liabilities+equity=${bsAfter.totalLiabilitiesAndEquity} delta=${bsAfter.difference} (shift=${deltaShift})`,
      );
      assert(
        Math.abs(deltaShift) <= 0.01,
        `FA + WHT/VAT shifted BS imbalance by ${deltaShift} (before ${bsBefore.difference} → after ${bsAfter.difference})`,
      );
      console.log("[PASS] Balance sheet imbalance unchanged after FA + WHT/VAT");
    }

    console.log("\nALL STAGING PROBES PASSED\n");
  } finally {
    for (const id of createdExpenseIds) {
      await deleteTaxLedgerEntriesForSource(admin, "expense_register", id);
      await admin.from("expense_register").delete().eq("id", id);
    }
    for (const id of createdAssetIds) {
      await deleteTaxLedgerEntriesForSource(admin, "fixed_asset", id);
      await admin.from("fixed_assets").delete().eq("asset_id", id);
    }
    console.log(
      `Cleaned up ${createdExpenseIds.length} expenses, ${createdAssetIds.length} assets`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
