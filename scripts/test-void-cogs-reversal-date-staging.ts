/**
 * Verify void_product_sale COGS reversal uses original sale date (staging / Davors).
 * Creates a backdated test sale in June 2026, voids it, checks dates + June BS.
 *
 *   npx tsx scripts/test-void-cogs-reversal-date-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const JUN_IDX = 5;
const SALE_DATE = "2026-06-20";
const TAG = `VOID-DATE-${Date.now().toString(36).toUpperCase()}`;

function loadEnv(f) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fetchBsDiff(admin, monthIndex) {
  const data = await fetchBalanceSheetPageData(admin, DAVORS);
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
      tenantId: DAVORS,
      accountsPayablePayments: data.initialAccountsPayablePayments,
      directorsLoanRepayments: data.initialDirectorsLoanRepayments,
    },
  );
  const check = getBalanceCheckForPeriod(report, monthIndex);
  return { difference: r2(check.difference), isBalanced: check.isBalanced };
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), "Not staging");
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const today = new Date().toISOString().slice(0, 10);
  assert(
    today.slice(0, 7) !== SALE_DATE.slice(0, 7),
    "Test sale month must differ from current month",
  );

  const productCode = `VOID-DATE-TEST-${TAG}`;
  const { client: pg } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });

  let productId: string;
  try {
    const ins = await pg.query(
      `INSERT INTO finished_products (
         tenant_id, product_code, product_name, unit_of_measure,
         current_stock, sourcing_type, is_archived
       ) VALUES ($1, $2, $3, 'pcs', 0, 'purchased', false)
       RETURNING id`,
      [DAVORS, productCode, `Void COGS date test ${TAG}`],
    );
    productId = ins.rows[0].id;

    const supplierRes = await pg.query(
      `SELECT id FROM suppliers WHERE tenant_id = $1 LIMIT 1`,
      [DAVORS],
    );
    assert(supplierRes.rows[0]?.id, "Need at least one supplier on Davors staging");
    const supplierId = supplierRes.rows[0].id;

    await pg.query(
      `INSERT INTO product_purchases (
         tenant_id, product_id, purchase_date, quantity, cost_per_unit, total_cost,
         supplier_id, payment_method, notes, remaining_quantity
       ) VALUES ($1, $2, $3::date, 5, 4, 20, $4, 'Cash', $5, 5)`,
      [DAVORS, productId, "2026-06-01", supplierId, TAG],
    );
    await pg.query(
      `UPDATE finished_products SET current_stock = current_stock + 5, updated_at = now() WHERE id = $1`,
      [productId],
    );
    await pg.query(
      `SELECT public.adjust_finished_product_balance_qty($1::uuid, $2::uuid, NULL::uuid, 5)`,
      [DAVORS, productId],
    );
  } finally {
    await pg.end();
  }

  const { data: product } = await admin
    .from("finished_products")
    .select("id, product_code, current_stock")
    .eq("id", productId)
    .single();
  assert(product && Number(product.current_stock) >= 1, "Test product needs stock after purchase");

  const qty = 1;
  const unitPrice = 10;

  const bsBaseline = await fetchBsDiff(admin, JUN_IDX);
  console.log("June BS baseline:", bsBaseline);

  const invoiceNo = `DF-PSI-${TAG}`;
  const { data: incomeId, error: saleErr } = await admin.rpc("create_product_sale", {
    p_date: SALE_DATE,
    p_invoice_no: invoiceNo,
    p_client_id: null,
    p_customer_name: "Void date test walk-in",
    p_product_id: productId,
    p_quantity: qty,
    p_unit_price: unitPrice,
    p_amount_received: r2(qty * unitPrice),
    p_payment_status: "Paid",
    p_due_date: null,
    p_description: `Void COGS date test ${TAG}`,
    p_notes: TAG,
    p_invoice_entity_type: "PSI",
    p_sales_rep_id: null,
    p_business_unit_id: null,
  });
  assert(!saleErr && incomeId, saleErr?.message ?? "create_product_sale failed");

  const { data: saleRow } = await admin
    .from("income_register")
    .select("id, date, invoice_no, cogs_expense_id, amount")
    .eq("id", incomeId)
    .single();

  const { data: cogsRow } = await admin
    .from("expense_register")
    .select("date, amount, receipt_no")
    .eq("id", saleRow.cogs_expense_id)
    .maybeSingle();

  console.log("\nCreated test sale:", {
    incomeId,
    invoiceNo: saleRow.invoice_no,
    saleDate: saleRow.date,
    cogs: cogsRow,
  });

  const bsWithSale = await fetchBsDiff(admin, JUN_IDX);
  console.log("June BS with active sale:", bsWithSale);

  const { error: voidErr } = await admin.rpc("void_product_sale", {
    p_income_id: incomeId,
  });
  assert(!voidErr, voidErr?.message ?? "void_product_sale failed");

  const { data: voided } = await admin
    .from("income_register")
    .select("sale_status, cogs_reversal_expense_id")
    .eq("id", incomeId)
    .single();

  const { data: reversal } = await admin
    .from("expense_register")
    .select("date, amount, receipt_no, payment_status")
    .eq("id", voided.cogs_reversal_expense_id)
    .maybeSingle();

  console.log("\nAfter void:", {
    sale_status: voided.sale_status,
    reversal,
    today,
  });

  assert(reversal, "Missing VOID-COGS reversal expense");
  assert(
    String(reversal.date).slice(0, 10) === SALE_DATE,
    `VOID-COGS date ${reversal.date} != sale date ${SALE_DATE}`,
  );
  assert(
    String(reversal.date).slice(0, 10) !== today,
    `VOID-COGS incorrectly dated to today (${today}) instead of sale month`,
  );
  assert(reversal.receipt_no === `VOID-COGS-${invoiceNo}`, "Unexpected reversal receipt_no");
  assert(r2(reversal.amount) === r2(-(cogsRow?.amount ?? 0)), "Reversal amount must negate COGS");

  const bsAfterVoid = await fetchBsDiff(admin, JUN_IDX);
  console.log("\nJune BS after void:", bsAfterVoid);

  assert(
    bsAfterVoid.difference === bsBaseline.difference,
    `June BS diff changed: baseline=${bsBaseline.difference} afterVoid=${bsAfterVoid.difference}`,
  );

  console.log("\nPASS: VOID-COGS dated to sale month; June BS restored to baseline.");

  const { client: pgCleanup } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  try {
    await pgCleanup.query(`DELETE FROM product_purchases WHERE product_id = $1`, [productId]);
    await pgCleanup.query(`DELETE FROM finished_product_balances WHERE product_id = $1`, [productId]);
  } finally {
    await pgCleanup.end();
  }

  const { error: delErr } = await admin.rpc("delete_finished_product_cascade", {
    p_product_id: productId,
  });
  assert(!delErr, delErr?.message ?? "delete_finished_product_cascade cleanup failed");
  console.log("Cleaned up isolated test product via delete_finished_product_cascade");
}

main().catch((e) => {
  console.error("\nFAIL:", e);
  process.exit(1);
});
