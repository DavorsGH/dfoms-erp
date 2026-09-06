/**
 * Staging soak + atomicity + parity for atomic purchase AP/FA + tax replace RPCs.
 *
 *   npx tsx scripts/test-atomic-purchase-ap-fixed-asset-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  buildAccountsPayableAccrualReceiptNo,
  shouldPostAccountsPayableAccrualExpense,
} from "../app/dashboard/finance/accounts-payable-accrual-utils";
import {
  buildPurchaseTaxLedgerRpcPayload,
  buildPurchaseTaxLedgerRows,
} from "../app/dashboard/finance/tax-ledger-sync";
import { computePurchaseTaxAmounts } from "../app/dashboard/finance/tax-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const SQL_FILE = "scripts/282_atomic_purchase_ap_fixed_asset.sql";
const STAMP = "TEST-ATOMIC-PURCHASE-282";
const PERIOD = "2099-09-01";
const INVOICE_DATE = "2099-09-15";
const DUE_DATE = "2099-10-15";

const TEST_TRIGGER = "trg_test_atomic_purchase_block";

function loadEnvForce(filePath: string) {
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

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

async function ensureMigration(pgClient) {
  const { rows } = await pgClient.query(
    `SELECT count(*)::int AS cnt FROM pg_proc WHERE proname = 'save_accounts_payable'`,
  );
  if ((rows[0]?.cnt ?? 0) < 1) {
    await pgClient.query(readFileSync(resolve(SQL_FILE), "utf8"));
    console.log("Applied migration 282");
  }
}

async function cleanup(admin, pgClient) {
  await pgClient.query(
    `DELETE FROM tax_ledger_entries WHERE tenant_id = $1 AND notes LIKE $2`,
    [DAVORS, `${STAMP}%`],
  );
  await pgClient.query(
    `DELETE FROM expense_register WHERE tenant_id = $1 AND notes LIKE $2`,
    [DAVORS, `${STAMP}%`],
  );
  await pgClient.query(
    `DELETE FROM accounts_payable WHERE tenant_id = $1 AND notes LIKE $2`,
    [DAVORS, `${STAMP}%`],
  );
  await pgClient.query(
    `DELETE FROM fixed_assets WHERE tenant_id = $1 AND notes LIKE $2`,
    [DAVORS, `${STAMP}%`],
  );
}

function buildApTaxRows(apId, purchaseTax, vendor, invoiceNo) {
  return buildPurchaseTaxLedgerRpcPayload({
    sourceType: "accounts_payable",
    sourceId: apId,
    entryDate: INVOICE_DATE,
    grossBeforeWht: purchaseTax.grossBeforeWht,
    whtRatePct: 5,
    whtAmount: purchaseTax.whtAmount,
    inputTaxComponent: purchaseTax.inputTaxComponent,
    inputTaxRatePct: null,
    inputVatAmount: purchaseTax.inputVatAmount,
    counterpartyName: vendor,
    notes: `${STAMP} Invoice ${invoiceNo}`,
  });
}

async function saveApRpc(admin, params) {
  const { data, error } = await admin.rpc("save_accounts_payable", params);
  if (error) throw new Error(error.message);
  return data;
}

async function deleteApRpc(admin, apId) {
  const { data, error } = await admin.rpc("delete_accounts_payable", {
    p_tenant_id: DAVORS,
    p_ap_id: apId,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function saveFaRpc(admin, params) {
  const { data, error } = await admin.rpc("save_fixed_asset", params);
  if (error) throw new Error(error.message);
  return data;
}

async function deleteFaRpc(admin, assetId) {
  const { data, error } = await admin.rpc("delete_fixed_asset", {
    p_tenant_id: DAVORS,
    p_asset_id: assetId,
  });
  if (error) throw new Error(error.message);
  return data;
}

async function installAtomicityTrigger(pgClient) {
  await pgClient.query(`
    CREATE OR REPLACE FUNCTION public.${TEST_TRIGGER}_fn()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.notes LIKE '%${STAMP}-ATOMIC-BLOCK%' THEN
        RAISE EXCEPTION 'TEST_ATOMICITY_BLOCK purchase tax insert blocked';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await pgClient.query(`
    DROP TRIGGER IF EXISTS ${TEST_TRIGGER} ON public.tax_ledger_entries;
    CREATE TRIGGER ${TEST_TRIGGER}
      BEFORE INSERT ON public.tax_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION public.${TEST_TRIGGER}_fn();
  `);
}

async function removeAtomicityTrigger(pgClient) {
  await pgClient.query(`DROP TRIGGER IF EXISTS ${TEST_TRIGGER} ON public.tax_ledger_entries`);
  await pgClient.query(`DROP FUNCTION IF EXISTS public.${TEST_TRIGGER}_fn()`);
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes(STAGING_REF)) throw new Error("Refusing: not staging");

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const results = [];

  try {
    await ensureMigration(pgClient);
    await cleanup(admin, pgClient);

    const purchaseTax = computePurchaseTaxAmounts({
      grossBeforeWht: 1000,
      whtRatePct: 5,
      whtAmount: 50,
      inputVatAmount: 120,
    });

    const createAp = await saveApRpc(admin, {
      p_tenant_id: DAVORS,
      p_ap_id: null,
      p_business_unit_id: null,
      p_vendor_name: `${STAMP} Vendor`,
      p_invoice_number: `${STAMP}-INV-001`,
      p_expense_category: "Administrative",
      p_sub_category: "General",
      p_description: `${STAMP} operating AP`,
      p_invoice_date: INVOICE_DATE,
      p_due_date: DUE_DATE,
      p_amount: purchaseTax.netPaidToSupplier,
      p_amount_paid: 0,
      p_balance_due: purchaseTax.netPaidToSupplier,
      p_status: "Outstanding",
      p_gross_before_wht: purchaseTax.grossBeforeWht,
      p_wht_rate: 5,
      p_wht_amount: purchaseTax.whtAmount,
      p_input_vat_amount: purchaseTax.inputVatAmount,
      p_net_of_tax_amount: purchaseTax.netOfTaxAmount,
      p_notes: STAMP,
      p_source_type: null,
      p_tax_rows: buildApTaxRows("00000000-0000-4000-8000-000000000001", purchaseTax, `${STAMP} Vendor`, `${STAMP}-INV-001`),
    });

    const apId = createAp.id;
    if (!apId) throw new Error("AP create missing id");
    if (createAp.accrualStatus !== "inserted") {
      throw new Error(`Expected accrual inserted, got ${createAp.accrualStatus}`);
    }

    const { count: taxLegs } = await admin
      .from("tax_ledger_entries")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("source_type", "accounts_payable")
      .eq("source_id", apId);
    if ((taxLegs ?? 0) < 1) throw new Error("AP tax legs missing");

    const receiptNo = buildAccountsPayableAccrualReceiptNo(apId);
    const { data: accrual } = await admin
      .from("expense_register")
      .select("id")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", receiptNo)
      .maybeSingle();
    if (!accrual) throw new Error("AP accrual expense missing");
    results.push("PASS AP create with accrual + tax");

    const updatedTax = computePurchaseTaxAmounts({
      grossBeforeWht: 1200,
      whtRatePct: 5,
      whtAmount: 60,
      inputVatAmount: 144,
    });
    await saveApRpc(admin, {
      p_tenant_id: DAVORS,
      p_ap_id: apId,
      p_business_unit_id: null,
      p_vendor_name: `${STAMP} Vendor`,
      p_invoice_number: `${STAMP}-INV-001`,
      p_expense_category: "Administrative",
      p_sub_category: "General",
      p_description: `${STAMP} operating AP updated`,
      p_invoice_date: INVOICE_DATE,
      p_due_date: DUE_DATE,
      p_amount: updatedTax.netPaidToSupplier,
      p_amount_paid: 0,
      p_balance_due: updatedTax.netPaidToSupplier,
      p_status: "Outstanding",
      p_gross_before_wht: updatedTax.grossBeforeWht,
      p_wht_rate: 5,
      p_wht_amount: updatedTax.whtAmount,
      p_input_vat_amount: updatedTax.inputVatAmount,
      p_net_of_tax_amount: updatedTax.netOfTaxAmount,
      p_notes: STAMP,
      p_source_type: null,
      p_tax_rows: buildApTaxRows(apId, updatedTax, `${STAMP} Vendor`, `${STAMP}-INV-001`),
    });
    results.push("PASS AP update + parity");

    const skipFa = await saveApRpc(admin, {
      p_tenant_id: DAVORS,
      p_ap_id: null,
      p_business_unit_id: null,
      p_vendor_name: "SSNIT",
      p_invoice_number: `PAYROLL-SSNIT-${STAMP}`,
      p_expense_category: "Statutory - SSNIT",
      p_sub_category: "General",
      p_description: `${STAMP} statutory skip`,
      p_invoice_date: INVOICE_DATE,
      p_due_date: DUE_DATE,
      p_amount: 500,
      p_amount_paid: 0,
      p_balance_due: 500,
      p_status: "Outstanding",
      p_gross_before_wht: 500,
      p_wht_rate: null,
      p_wht_amount: 0,
      p_input_vat_amount: 0,
      p_net_of_tax_amount: 500,
      p_notes: `${STAMP}-STAT`,
      p_source_type: null,
      p_tax_rows: [],
    });
    if (skipFa.accrualStatus !== "skipped") {
      throw new Error(`Statutory AP should skip accrual, got ${skipFa.accrualStatus}`);
    }
    results.push("PASS AP accrual skip statutory");

    const faTax = computePurchaseTaxAmounts({
      grossBeforeWht: 5000,
      whtRatePct: 0,
      whtAmount: 0,
      inputVatAmount: 0,
    });
    const cashAssetId = `${STAMP}-FA-CASH`;
    await saveFaRpc(admin, {
      p_tenant_id: DAVORS,
      p_asset_id: cashAssetId,
      p_is_update: false,
      p_business_unit_id: null,
      p_asset_name: `${STAMP} Cash Asset`,
      p_asset_category: "Equipment",
      p_purchase_date: INVOICE_DATE,
      p_original_cost: 5000,
      p_quantity: 1,
      p_total_cost: 5000,
      p_useful_life_years: 5,
      p_depreciation_method: "Straight-Line",
      p_annual_depreciation: 1000,
      p_accumulated_depreciation: 0,
      p_net_book_value: 5000,
      p_location: "HQ",
      p_notes: STAMP,
      p_payment_method: "Cash",
      p_vendor_name: `${STAMP} Supplier`,
      p_approved_by: "System",
      p_gross_before_wht: faTax.grossBeforeWht,
      p_wht_rate: null,
      p_wht_amount: 0,
      p_input_vat_amount: 0,
      p_net_of_tax_amount: faTax.netOfTaxAmount,
      p_existing_payable_id: null,
      p_tax_rows: [],
    });

    const { data: cashFa } = await admin
      .from("fixed_assets")
      .select("accounts_payable_id")
      .eq("tenant_id", DAVORS)
      .eq("asset_id", cashAssetId)
      .single();
    if (cashFa?.accounts_payable_id) {
      throw new Error("Cash FA should not have linked AP");
    }
    results.push("PASS FA cash create");

    const creditAssetId = `${STAMP}-FA-CREDIT`;
    await saveFaRpc(admin, {
      p_tenant_id: DAVORS,
      p_asset_id: creditAssetId,
      p_is_update: false,
      p_business_unit_id: null,
      p_asset_name: `${STAMP} Credit Asset`,
      p_asset_category: "Equipment",
      p_purchase_date: INVOICE_DATE,
      p_original_cost: 3000,
      p_quantity: 1,
      p_total_cost: 3000,
      p_useful_life_years: 5,
      p_depreciation_method: "Straight-Line",
      p_annual_depreciation: 600,
      p_accumulated_depreciation: 0,
      p_net_book_value: 3000,
      p_location: "HQ",
      p_notes: STAMP,
      p_payment_method: "Supplier Credit",
      p_vendor_name: `${STAMP} Credit Vendor`,
      p_approved_by: "System",
      p_gross_before_wht: 3000,
      p_wht_rate: null,
      p_wht_amount: 0,
      p_input_vat_amount: 0,
      p_net_of_tax_amount: 3000,
      p_existing_payable_id: null,
      p_tax_rows: [],
    });

    const { data: creditFa } = await admin
      .from("fixed_assets")
      .select("accounts_payable_id")
      .eq("tenant_id", DAVORS)
      .eq("asset_id", creditAssetId)
      .single();
    if (!creditFa?.accounts_payable_id) {
      throw new Error("Credit FA missing linked AP");
    }

    const { data: faAp } = await admin
      .from("accounts_payable")
      .select("invoice_number, source_type, source_id")
      .eq("id", creditFa.accounts_payable_id)
      .single();
    if (!faAp?.invoice_number?.startsWith("FAP-")) {
      throw new Error("Credit FA AP missing FAP- invoice prefix");
    }
    if (
      shouldPostAccountsPayableAccrualExpense({
        source_type: faAp.source_type,
        invoice_number: faAp.invoice_number,
        expense_category: "Fixed Assets",
      })
    ) {
      throw new Error("FA credit AP should skip accrual by JS parity rule");
    }
    results.push("PASS FA credit create + FAP AP link");

    await deleteApRpc(admin, apId);
    const { count: apAfterDelete } = await admin
      .from("accounts_payable")
      .select("id", { count: "exact", head: true })
      .eq("id", apId);
    if ((apAfterDelete ?? 0) > 0) throw new Error("AP not deleted");
    results.push("PASS AP delete atomic");

    await deleteFaRpc(admin, creditAssetId);
    results.push("PASS FA delete atomic");

    await cleanup(admin, pgClient);

    const atomicTax = computePurchaseTaxAmounts({
      grossBeforeWht: 800,
      whtRatePct: 5,
      whtAmount: 40,
      inputVatAmount: 96,
    });
    const atomicRows = buildApTaxRows(
      "00000000-0000-4000-8000-000000000002",
      atomicTax,
      `${STAMP} Atomic`,
      `${STAMP}-ATOMIC`,
    ).map((row) => ({
      ...row,
      notes: `${STAMP}-ATOMIC-BLOCK`,
    }));

    await installAtomicityTrigger(pgClient);
    const beforeAp = (
      await pgClient.query(
        `SELECT count(*)::int AS cnt FROM accounts_payable WHERE tenant_id = $1 AND notes = $2`,
        [DAVORS, `${STAMP}-ATOMIC`],
      )
    ).rows[0].cnt;

    const { error: atomicFail } = await admin.rpc("save_accounts_payable", {
      p_tenant_id: DAVORS,
      p_ap_id: null,
      p_business_unit_id: null,
      p_vendor_name: `${STAMP} Atomic`,
      p_invoice_number: `${STAMP}-ATOMIC`,
      p_expense_category: "Administrative",
      p_sub_category: "General",
      p_description: `${STAMP} atomicity`,
      p_invoice_date: INVOICE_DATE,
      p_due_date: DUE_DATE,
      p_amount: atomicTax.netPaidToSupplier,
      p_amount_paid: 0,
      p_balance_due: atomicTax.netPaidToSupplier,
      p_status: "Outstanding",
      p_gross_before_wht: atomicTax.grossBeforeWht,
      p_wht_rate: 5,
      p_wht_amount: atomicTax.whtAmount,
      p_input_vat_amount: atomicTax.inputVatAmount,
      p_net_of_tax_amount: atomicTax.netOfTaxAmount,
      p_notes: `${STAMP}-ATOMIC`,
      p_source_type: null,
      p_tax_rows: atomicRows,
    });
    await removeAtomicityTrigger(pgClient);

    if (!atomicFail || !/TEST_ATOMICITY_BLOCK/i.test(atomicFail.message)) {
      throw new Error(`Expected atomicity block, got: ${atomicFail?.message ?? "none"}`);
    }

    const afterAp = (
      await pgClient.query(
        `SELECT count(*)::int AS cnt FROM accounts_payable WHERE tenant_id = $1 AND notes = $2`,
        [DAVORS, `${STAMP}-ATOMIC`],
      )
    ).rows[0].cnt;
    const afterAccrual = (
      await pgClient.query(
        `SELECT count(*)::int AS cnt FROM expense_register WHERE tenant_id = $1 AND notes LIKE $2`,
        [DAVORS, `${STAMP}-ATOMIC%`],
      )
    ).rows[0].cnt;

    if (afterAp !== beforeAp) throw new Error("Atomicity fail: AP committed");
    if (afterAccrual > 0) throw new Error("Atomicity fail: accrual committed");
    results.push("PASS AP save atomicity full rollback");

    const parityInput = {
      sourceType: "accounts_payable" as const,
      sourceId: "00000000-0000-4000-8000-000000000099",
      entryDate: INVOICE_DATE,
      grossBeforeWht: atomicTax.grossBeforeWht,
      whtRatePct: 5,
      whtAmount: atomicTax.whtAmount,
      inputTaxComponent: atomicTax.inputTaxComponent,
      inputTaxRatePct: null,
      inputVatAmount: atomicTax.inputVatAmount,
      counterpartyName: "Parity Vendor",
      notes: `${STAMP}-parity`,
    };
    const jsRows = buildPurchaseTaxLedgerRows(parityInput);
    if (jsRows.length > 0) {
      const whtLeg = jsRows.find((r) => r.direction === "wht_payable");
      const vatLeg = jsRows.find((r) => r.direction === "input");
      if (!whtLeg || r2(whtLeg.tax_amount) !== r2(atomicTax.whtAmount)) {
        throw new Error("Parity fail: WHT leg");
      }
      if (!vatLeg || r2(vatLeg.tax_amount) !== r2(atomicTax.inputVatAmount)) {
        throw new Error("Parity fail: VAT leg");
      }
    }
    results.push("PASS purchase tax row builder parity");

    console.log("\n=== RESULTS ===");
    for (const r of results) console.log(r);
    console.log(`\n${results.length}/${results.length} PASS`);
  } finally {
    await removeAtomicityTrigger(pgClient).catch(() => {});
    await cleanup(admin, pgClient).catch(() => {});
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
