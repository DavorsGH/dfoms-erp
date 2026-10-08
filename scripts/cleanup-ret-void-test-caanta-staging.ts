/**
 * Remove Caanta RET-VOID double-reversal test artifacts on staging.
 *   npx tsx scripts/cleanup-ret-void-test-caanta-staging.ts --investigate-only
 *   npx tsx scripts/cleanup-ret-void-test-caanta-staging.ts --execute
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { auditTenantBalanceSheetIntegrity } from "../utils/balance-sheet-integrity";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const REF_DATE = new Date("2026-12-31T12:00:00.000Z");
const INVOICE_PATTERN = "DF-POS-RET-VOID-%";
const PRIMARY_INVOICE = "DF-POS-RET-VOID-MUZRDBNK";
const PRODUCT_ID = "a252224d-0760-4984-8af5-1c61dd01be55";
const BU_ID = "7399c787-8712-4e97-a967-cfc6eba67762";
/** Master + BU stock before the disposable test (Oct 2026). */
const TARGET_STOCK = 50;

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

function r4(n) {
  return Math.round(Number(n || 0) * 10000) / 10000;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stockSnapshot(admin) {
  const [{ data: fp }, { data: fpb }] = await Promise.all([
    admin.from("finished_products").select("current_stock, product_code").eq("id", PRODUCT_ID).single(),
    admin
      .from("finished_product_balances")
      .select("current_stock, business_unit_id")
      .eq("tenant_id", CAANTA)
      .eq("product_id", PRODUCT_ID),
  ]);
  return {
    productCode: fp?.product_code,
    master: r4(fp?.current_stock),
    bu: (fpb ?? []).map((r) => ({
      bu: r.business_unit_id,
      stock: r4(r.current_stock),
    })),
  };
}

async function bsIntegrity(admin, tenantId, name) {
  const result = await auditTenantBalanceSheetIntegrity(
    admin,
    { id: tenantId, name },
    FY,
    REF_DATE,
  );
  const julDec = result.imbalances.filter((i) => i.monthIndex >= 6 && i.monthIndex <= 11);
  return {
    status: result.status,
    maxAbsDiff: result.maxAbsDiff,
    julDecImbalances: julDec,
    scopeResults: result.scopeResults.map((s) => ({
      scope: s.scope,
      bu: s.businessUnitName,
      maxAbsDiff: s.maxAbsDiff,
      julDec: s.imbalances.filter((i) => i.monthIndex >= 6 && i.monthIndex <= 11),
    })),
  };
}

async function main() {
  const execute = process.argv.includes("--execute");
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  assert(
    String(process.env.NEXT_PUBLIC_SUPABASE_URL).includes(STAGING_REF),
    "Refusing non-staging",
  );

  const { data: sales } = await admin
    .from("income_register")
    .select("id, invoice_no, sale_status, amount, is_sale_return, cogs_expense_id, cogs_reversal_expense_id, credit_note_id")
    .eq("tenant_id", CAANTA)
    .like("invoice_no", INVOICE_PATTERN);

  const incomeIds = (sales ?? []).map((s) => s.id);
  const expenseIds = new Set();
  for (const s of sales ?? []) {
    if (s.cogs_expense_id) expenseIds.add(s.cogs_expense_id);
    if (s.cogs_reversal_expense_id) expenseIds.add(s.cogs_reversal_expense_id);
  }

  const { data: cnLines } = incomeIds.length
    ? await admin
        .from("credit_note_line_items")
        .select("id, credit_note_id, source_income_register_id")
        .in("source_income_register_id", incomeIds)
    : { data: [] };
  const creditNoteIds = [...new Set((cnLines ?? []).map((l) => l.credit_note_id))];

  const { data: creditNotes } = creditNoteIds.length
    ? await admin.from("credit_notes").select("id, credit_note_number").in("id", creditNoteIds)
    : { data: [] };

  const { data: refunds } = creditNoteIds.length
    ? await admin.from("refunds").select("id, credit_note_id").in("credit_note_id", creditNoteIds)
    : { data: [] };

  const stockBefore = await stockSnapshot(admin);
  const bsCaantaBefore = await bsIntegrity(admin, CAANTA, "Caanta");
  const bsDavorsBefore = await bsIntegrity(admin, DAVORS, "Davors");

  console.log("\n=== INVESTIGATE ===");
  console.log(
    JSON.stringify(
      {
        tenant: "Caanta Market",
        businessUnit: "Caanta Market place",
        invoicePrefix: INVOICE_PATTERN,
        note: "DF-POS prefix is from test create_product_sale entity type POS, not Davors tenant.",
        sales,
        creditNotes,
        cnLineCount: cnLines?.length ?? 0,
        refunds,
        expenseIds: [...expenseIds],
        stockBefore,
        targetStock: TARGET_STOCK,
      },
      null,
      2,
    ),
  );

  if (!execute) {
    console.log("\nPass --execute to delete artifacts and restore stock.");
    return;
  }

  const { client: pg } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });

  try {
    await pg.query("BEGIN");

    if (refunds?.length) {
      const { rows: refundExpenses } = await pg.query(
        `SELECT id FROM expense_register
         WHERE tenant_id = $1::uuid
           AND receipt_no = ANY(
             SELECT 'REFUND-' || credit_note_number
             FROM credit_notes WHERE id = ANY($2::uuid[])
           )`,
        [CAANTA, creditNoteIds],
      );
      for (const row of refundExpenses) {
        expenseIds.add(row.id);
      }
      await pg.query(`DELETE FROM refunds WHERE id = ANY($1::uuid[])`, [
        refunds.map((r) => r.id),
      ]);
    }

    if (cnLines?.length) {
      await pg.query(
        `DELETE FROM credit_note_line_items WHERE id = ANY($1::uuid[])`,
        [cnLines.map((l) => l.id)],
      );
    }

    if (incomeIds.length) {
      await pg.query(
        `DELETE FROM sale_batch_allocations WHERE sale_id = ANY($1::uuid[]) AND sale_source = 'product_sale'`,
        [incomeIds],
      );
      await pg.query(
        `DELETE FROM stock_movements WHERE reference_id = ANY($1::uuid[])`,
        [incomeIds],
      );
      await pg.query(
        `DELETE FROM tax_ledger_entries WHERE source_id::text = ANY($1::text[])`,
        [incomeIds],
      );
      await pg.query(`DELETE FROM income_register WHERE id = ANY($1::uuid[])`, [incomeIds]);
    }

    if (creditNoteIds.length) {
      await pg.query(`DELETE FROM credit_notes WHERE id = ANY($1::uuid[])`, [creditNoteIds]);
    }

    const expList = [...expenseIds];
    if (expList.length) {
      await pg.query(
        `DELETE FROM tax_ledger_entries WHERE source_id::text = ANY($1::text[])`,
        [expList],
      );
      await pg.query(`DELETE FROM expense_register WHERE id = ANY($1::uuid[])`, [expList]);
    }

    await pg.query(
      `UPDATE finished_products SET current_stock = $2, updated_at = now() WHERE id = $1 AND tenant_id = $3`,
      [PRODUCT_ID, TARGET_STOCK, CAANTA],
    );
    await pg.query(
      `UPDATE finished_product_balances
       SET current_stock = $3, updated_at = now()
       WHERE tenant_id = $1 AND product_id = $2 AND business_unit_id = $4`,
      [CAANTA, PRODUCT_ID, TARGET_STOCK, BU_ID],
    );

    await pg.query("COMMIT");
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  } finally {
    await pg.end();
  }

  const { data: salesLeft } = await admin
    .from("income_register")
    .select("id")
    .eq("tenant_id", CAANTA)
    .like("invoice_no", INVOICE_PATTERN);
  assert(!salesLeft?.length, "Test sales still present");

  const stockAfter = await stockSnapshot(admin);
  assert(stockAfter.master === TARGET_STOCK, `Master stock ${stockAfter.master} != ${TARGET_STOCK}`);
  const buRow = stockAfter.bu.find((b) => b.bu === BU_ID);
  assert(buRow?.stock === TARGET_STOCK, `BU stock ${buRow?.stock} != ${TARGET_STOCK}`);

  const bsCaantaAfter = await bsIntegrity(admin, CAANTA, "Caanta");
  const bsDavorsAfter = await bsIntegrity(admin, DAVORS, "Davors");

  console.log("\n=== POST-CLEANUP ===");
  console.log(JSON.stringify({ stockAfter, bsCaantaAfter, bsDavorsAfter }, null, 2));

  for (const label of ["Caanta", "Davors"]) {
    const bs = label === "Caanta" ? bsCaantaAfter : bsDavorsAfter;
    for (const scope of bs.scopeResults) {
      for (const imb of scope.julDec) {
        assert(
          Math.abs(imb.diff) < 0.005,
          `${label} ${scope.bu} ${imb.monthLabel} diff ${imb.diff}`,
        );
      }
    }
  }

  console.log("\nPASS: artifacts removed; stock restored; Jul–Dec 2026 BS 0.00 all scopes (Caanta + Davors).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
