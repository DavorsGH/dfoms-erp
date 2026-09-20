/**
 * Void + remove orphan test sale DF-POS-0010 and product P4-FP-1787588915998 on staging.
 *
 *   npx tsx scripts/cleanup-df-pos-0010-staging.ts --investigate-only
 *   npx tsx scripts/cleanup-df-pos-0010-staging.ts --execute
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const JUL_IDX = 6;
const AUG_IDX = 7;
const INCOME_ID = "f9b4ec48-3eb9-4d9d-be57-6fbf7a3f8d26";
const INVOICE_NO = "DF-POS-0010";
const PRODUCT_ID = "95f26ef4-df93-4c90-9b8b-947f37ed0421";
const PRODUCT_CODE = "P4-FP-1787588915998";

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

function log(section, detail) {
  console.log(`\n=== ${section} ===`);
  console.log(typeof detail === "string" ? detail : JSON.stringify(detail, null, 2));
}

async function fetchBs(admin, monthIndex) {
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
  return { difference: r2(check.difference), isBalanced: check.isBalanced, check };
}

async function auditProductReferences(admin) {
  const [
    { data: sales },
    { data: purchases },
    { data: batches },
    { data: movements },
    { data: internalUse },
    { data: balances },
    { data: conflicts },
  ] = await Promise.all([
    admin
      .from("income_register")
      .select("id, invoice_no, sale_status, date, amount")
      .eq("tenant_id", DAVORS)
      .eq("product_id", PRODUCT_ID),
    admin.from("product_purchases").select("id").eq("product_id", PRODUCT_ID),
    admin.from("production_batches").select("id").eq("finished_product_id", PRODUCT_ID),
    admin.from("stock_movements").select("id, movement_type, quantity, notes").eq("product_id", PRODUCT_ID),
    admin.from("internal_consumption").select("id").eq("product_id", PRODUCT_ID),
    admin.from("finished_product_balances").select("*").eq("product_id", PRODUCT_ID),
    admin
      .from("offline_sale_conflicts")
      .select("id, status, resolution, claim")
      .eq("tenant_id", DAVORS)
      .contains("claim", { lines: [{ product_id: PRODUCT_ID }] }),
  ]);

  const conflictHits = [];
  const { data: allConflicts } = await admin
    .from("offline_sale_conflicts")
    .select("id, status, resolution, claim, client_op_id")
    .eq("tenant_id", DAVORS);
  for (const c of allConflicts ?? []) {
    const lines = c.claim?.lines ?? c.claim?.payload?.lines ?? [];
    if (
      Array.isArray(lines) &&
      lines.some((l) => String(l.product_id) === PRODUCT_ID)
    ) {
      conflictHits.push(c);
    }
  }

  return {
    sales: sales ?? [],
    purchases: purchases ?? [],
    batches: batches ?? [],
    movements: movements ?? [],
    internalUse: internalUse ?? [],
    balances: balances ?? [],
    conflicts: conflictHits,
  };
}

async function main() {
  const execute = process.argv.includes("--execute");
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging: ${url}`);
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: sale } = await admin
    .from("income_register")
    .select("*")
    .eq("id", INCOME_ID)
    .maybeSingle();
  assert(sale, "Sale not found");
  assert(sale.invoice_no === INVOICE_NO, `Expected ${INVOICE_NO}, got ${sale.invoice_no}`);

  const { data: cogsExp } = sale.cogs_expense_id
    ? await admin.from("expense_register").select("*").eq("id", sale.cogs_expense_id).maybeSingle()
    : { data: null };

  const refs = await auditProductReferences(admin);
  const bsBefore = {
    july: await fetchBs(admin, JUL_IDX),
    august: await fetchBs(admin, AUG_IDX),
  };

  log("PRE-FLIGHT", {
    sale: {
      id: sale.id,
      invoice_no: sale.invoice_no,
      sale_status: sale.sale_status,
      amount: sale.amount,
      cogs_expense_id: sale.cogs_expense_id,
    },
    cogs: cogsExp
      ? { receipt_no: cogsExp.receipt_no, amount: cogsExp.amount, payment_status: cogsExp.payment_status }
      : null,
    productReferences: refs,
    bsBefore,
  });

  const safeToDeleteProduct =
    refs.purchases.length === 0 &&
    refs.batches.length === 0 &&
    refs.internalUse.length === 0 &&
    refs.sales.length <= 1 &&
    refs.sales.every((s) => s.id === INCOME_ID);

  log("PRODUCT DELETE ASSESSMENT", {
    safeToDeleteProduct,
    rationale: safeToDeleteProduct
      ? "Only the orphan test sale references this product; no purchases, batches, or internal use."
      : "Other references exist — product will be kept after void.",
  });

  if (!execute) {
    log("MODE", "investigate-only — pass --execute to void sale and optionally delete product");
    return;
  }

  if (sale.sale_status !== "voided") {
    log("STEP 1", "void_product_sale RPC");
    const { error: voidErr } = await admin.rpc("void_product_sale", {
      p_income_id: INCOME_ID,
    });
    assert(!voidErr, `void_product_sale failed: ${voidErr?.message}`);
  } else {
    log("STEP 1", "Sale already voided — skipping void_product_sale");
  }

  if (safeToDeleteProduct) {
    log("STEP 2", "delete_finished_product_cascade RPC (removes sale + COGS rows entirely)");
    const { error: delErr } = await admin.rpc("delete_finished_product_cascade", {
      p_product_id: PRODUCT_ID,
    });
    assert(!delErr, `delete_finished_product_cascade failed: ${delErr?.message}`);

    const { data: productLeft } = await admin
      .from("finished_products")
      .select("id")
      .eq("id", PRODUCT_ID);
    assert(!productLeft?.length, "Product still exists after cascade delete");

    const { data: saleLeft } = await admin
      .from("income_register")
      .select("id")
      .eq("id", INCOME_ID);
    assert(!saleLeft?.length, "Sale income row still exists after cascade delete");

    const { data: cogsLeft } = await admin
      .from("expense_register")
      .select("receipt_no")
      .eq("tenant_id", DAVORS)
      .in("receipt_no", ["COGS-DF-POS-0010", "VOID-COGS-DF-POS-0010"]);
    assert(!cogsLeft?.length, `COGS rows remain: ${JSON.stringify(cogsLeft)}`);
  } else {
    log("STEP 2", "Product kept — void-only cleanup (note: VOID-COGS dated today may not fix prior-month BS)");
  }

  const bsFinal = {
    july: await fetchBs(admin, JUL_IDX),
    august: await fetchBs(admin, AUG_IDX),
  };
  log("BS FINAL", bsFinal);
  assert(bsFinal.august.difference === 0, `August BS final diff ${bsFinal.august.difference}`);
  assert(bsFinal.july.difference === 0, `July BS final diff ${bsFinal.july.difference}`);

  const { data: septMec } = await admin
    .from("month_end_close")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("month", "2026-09-01")
    .maybeSingle();
  log("SEPTEMBER MEC", septMec ?? null);
}

main().catch((e) => {
  console.error("\nFATAL:", e);
  process.exit(1);
});
