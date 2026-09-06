/**
 * Staging soak + atomicity + parity for atomic client invoice + POS checkout RPCs.
 *
 *   npx tsx scripts/test-atomic-invoice-pos-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const SQL_283 = "scripts/283_atomic_client_invoice.sql";
const SQL_284 = "scripts/284_atomic_pos_checkout.sql";
const BLOCK_TAX_TRIGGER = "trg_test_ci_block_tax_ledger_insert";

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

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function ensureMigrations(pgClient) {
  for (const [file, fn] of [
    [SQL_283, "save_client_invoice"],
    [SQL_284, "checkout_pos_cart"],
  ]) {
    const { rows } = await pgClient.query(
      `SELECT count(*)::int AS cnt FROM pg_proc WHERE proname = $1`,
      [fn],
    );
    if ((rows[0]?.cnt ?? 0) < 1) {
      await pgClient.query(readFileSync(resolve(file), "utf8"));
      console.log(`Applied ${file}`);
    }
  }
}

async function pickClient(pgClient) {
  const { rows } = await pgClient.query(
    `SELECT client_id, client_name FROM customers WHERE tenant_id = $1 LIMIT 1`,
    [DAVORS],
  );
  assert(rows[0]?.client_id, "No customer on staging");
  return rows[0];
}

async function countInvoiceArtifacts(pgClient, invoiceId) {
  const { rows } = await pgClient.query(
    `
    SELECT
      (SELECT count(*)::int FROM client_invoices WHERE id = $1) AS invoices,
      (SELECT count(*)::int FROM client_invoice_line_items WHERE invoice_id = $1) AS lines,
      (SELECT count(*)::int FROM income_register WHERE client_invoice_id = $1) AS income,
      (SELECT count(*)::int FROM tax_ledger_entries t
         JOIN income_register i ON i.id::text = t.source_id
        WHERE i.client_invoice_id = $1 AND t.source_type = 'income_register') AS tax_legs
    `,
    [invoiceId],
  );
  return rows[0];
}

async function installTaxBlockTrigger(pgClient) {
  await pgClient.query(`
    CREATE OR REPLACE FUNCTION public.test_ci_block_tax_ledger_insert()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'TEST_BLOCK_TAX_LEDGER';
    END;
    $$;
  `);
  await pgClient.query(`
    DROP TRIGGER IF EXISTS ${BLOCK_TAX_TRIGGER} ON public.tax_ledger_entries;
    CREATE TRIGGER ${BLOCK_TAX_TRIGGER}
      BEFORE INSERT ON public.tax_ledger_entries
      FOR EACH ROW EXECUTE FUNCTION public.test_ci_block_tax_ledger_insert();
  `);
}

async function removeTaxBlockTrigger(pgClient) {
  await pgClient.query(`DROP TRIGGER IF EXISTS ${BLOCK_TAX_TRIGGER} ON public.tax_ledger_entries`);
}

async function testInvoiceCreateEditStatusVoid(admin, pgClient) {
  const client = await pickClient(pgClient);
  const payload = {
    client_id: client.client_id,
    invoice_date: "2026-09-06",
    due_date: "2026-10-06",
    bill_to_name: client.client_name,
    vat_nhil_getfund_rate: 20,
    wht_rate: 7.5,
    status: "draft",
    line_items: [
      {
        description: "Atomic invoice test labour",
        labour_amount: 100,
        material_amount: 0,
        discount_amount: 0,
        taxed: true,
        sort_order: 0,
      },
    ],
    payment_account_ids: [],
  };

  const { data: created, error: createErr } = await admin.rpc("save_client_invoice", {
    p_tenant_id: DAVORS,
    p_invoice_id: null,
    p_business_unit_id: null,
    p_payload: payload,
  });
  assert(!createErr, createErr?.message ?? "create failed");
  const invoice = created?.invoice;
  assert(invoice?.id, "missing invoice id");
  assert(invoice.status === "draft", "create must force draft");

  let arts = await countInvoiceArtifacts(pgClient, invoice.id);
  assert(arts.invoices === 1 && arts.lines === 1, "draft header/lines");
  assert(arts.income === 0 && arts.tax_legs === 0, "draft must not sync income/tax");

  const { data: sent, error: sentErr } = await admin.rpc("change_client_invoice_status", {
    p_tenant_id: DAVORS,
    p_invoice_id: invoice.id,
    p_next_status: "sent",
  });
  assert(!sentErr, sentErr?.message ?? "sent failed");
  arts = await countInvoiceArtifacts(pgClient, invoice.id);
  assert(arts.income === 1, "sent must create income row");
  assert(arts.tax_legs >= 1, "sent must create tax legs");

  payload.line_items[0].labour_amount = 150;
  payload.status = "sent";
  const { data: edited, error: editErr } = await admin.rpc("save_client_invoice", {
    p_tenant_id: DAVORS,
    p_invoice_id: invoice.id,
    p_business_unit_id: invoice.business_unit_id,
    p_payload: payload,
  });
  assert(!editErr, editErr?.message ?? "edit failed");
  assert(Number(edited?.invoice?.subtotal) === 150, "edit subtotal parity");

  const { data: paid, error: paidErr } = await admin.rpc("change_client_invoice_status", {
    p_tenant_id: DAVORS,
    p_invoice_id: invoice.id,
    p_next_status: "paid",
  });
  assert(!paidErr, paidErr?.message ?? "paid failed");
  assert(paid?.invoice?.status === "paid", "paid status");

  const { data: voided, error: voidErr } = await admin.rpc("void_client_invoice", {
    p_tenant_id: DAVORS,
    p_invoice_id: invoice.id,
  });
  assert(!voidErr, voidErr?.message ?? "void failed");
  arts = await countInvoiceArtifacts(pgClient, invoice.id);
  assert(arts.income === 1, "void keeps income row");
  assert(arts.tax_legs === 0, "void deletes tax legs");

  console.log("PASS invoice create/edit/status/void soak");
  return invoice.id;
}

async function testInvoiceAtomicityOnTaxFailure(admin, pgClient) {
  await installTaxBlockTrigger(pgClient);
  try {
    const client = await pickClient(pgClient);
    const payload = {
      client_id: client.client_id,
      invoice_date: "2026-09-06",
      bill_to_name: client.client_name,
      vat_nhil_getfund_rate: 20,
      wht_rate: 0,
      status: "draft",
      line_items: [
        {
          description: "Atomic rollback test",
          labour_amount: 50,
          material_amount: 0,
          discount_amount: 0,
          taxed: true,
          sort_order: 0,
        },
      ],
      payment_account_ids: [],
    };

    const { data: created, error: createErr } = await admin.rpc("save_client_invoice", {
      p_tenant_id: DAVORS,
      p_invoice_id: null,
      p_business_unit_id: null,
      p_payload: payload,
    });
    assert(!createErr && created?.invoice?.id, "draft create ok");
    const invoiceId = created.invoice.id;

    const { error: sentErr } = await admin.rpc("change_client_invoice_status", {
      p_tenant_id: DAVORS,
      p_invoice_id: invoiceId,
      p_next_status: "sent",
    });
    assert(sentErr?.message?.includes("TEST_BLOCK_TAX_LEDGER"), "sent must fail on tax block");

    const arts = await countInvoiceArtifacts(pgClient, invoiceId);
    assert(arts.invoices === 1, "invoice row remains after rollback? should rollback status too");
    const { rows: statusRows } = await pgClient.query(
      `SELECT status FROM client_invoices WHERE id = $1`,
      [invoiceId],
    );
    assert(statusRows[0]?.status === "draft", "status change must roll back with tax failure");

    await pgClient.query(`DELETE FROM client_invoices WHERE id = $1`, [invoiceId]);
    console.log("PASS invoice status atomicity on tax failure");
  } finally {
    await removeTaxBlockTrigger(pgClient);
  }
}

async function pickProductWithStock(pgClient, minQty = 2) {
  const { rows } = await pgClient.query(
    `
    SELECT id, product_code, current_stock
    FROM finished_products
    WHERE tenant_id = $1 AND current_stock >= $2
    ORDER BY current_stock DESC
    LIMIT 1
    `,
    [DAVORS, minQty],
  );
  assert(rows[0]?.id, "No finished product with stock on staging");
  return rows[0];
}

async function countPosArtifacts(pgClient, incomeIds) {
  if (!incomeIds.length) {
    return { income: 0, stock_moves: 0, cogs: 0, tax: 0 };
  }
  const { rows } = await pgClient.query(
    `
    SELECT
      (SELECT count(*)::int FROM income_register WHERE id = ANY($1::uuid[])) AS income,
      (SELECT count(*)::int FROM stock_movements WHERE reference_id = ANY($1::uuid[])) AS stock_moves,
      (SELECT count(*)::int FROM expense_register e
         JOIN income_register i ON i.cogs_expense_id = e.id
        WHERE i.id = ANY($1::uuid[])) AS cogs,
      (SELECT count(*)::int FROM tax_ledger_entries
        WHERE source_type = 'income_register' AND source_id = ANY(SELECT id::text FROM unnest($1::uuid[]) AS id)) AS tax
    `,
    [incomeIds],
  );
  return rows[0];
}

async function testPosCheckoutSuccess(admin, pgClient) {
  const product = await pickProductWithStock(pgClient, 2);
  const beforeStock = Number(product.current_stock);

  const { data, error } = await admin.rpc("checkout_pos_cart", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_sale_date: "2026-09-06",
    p_invoice_no: null,
    p_client_id: null,
    p_customer_name: "Walk-in atomic test",
    p_payment_status: "Paid",
    p_due_date: "2026-09-06",
    p_notes: null,
    p_payment_method: "Cash",
    p_sales_rep_id: null,
    p_amount_received: 20,
    p_lines: [
      { product_id: product.id, quantity: 1, unit_price: 10 },
      { product_id: product.id, quantity: 1, unit_price: 10 },
    ],
    p_payment_request_id: null,
    p_paid_amount: null,
    p_paystack_reference: null,
    p_paid_at: null,
  });
  assert(!error, error?.message ?? "checkout failed");
  const incomeIds = (data?.income_ids ?? []).filter(Boolean);
  assert(incomeIds.length === 2, "expected 2 income rows");
  assert(data?.invoice_no, "missing invoice_no");

  const arts = await countPosArtifacts(pgClient, incomeIds);
  assert(arts.income === 2 && arts.stock_moves === 2 && arts.cogs === 2, "POS artifacts");

  const { rows: stockRows } = await pgClient.query(
    `SELECT current_stock FROM finished_products WHERE id = $1`,
    [product.id],
  );
  assert(Number(stockRows[0]?.current_stock) === beforeStock - 2, "stock reduced by 2");

  console.log("PASS POS checkout success");
  return { incomeIds, invoiceNo: data.invoice_no };
}

async function testPosCheckoutRollback(admin, pgClient) {
  const product = await pickProductWithStock(pgClient, 1);
  const beforeStock = Number(product.current_stock);

  const { error } = await admin.rpc("checkout_pos_cart", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_sale_date: "2026-09-06",
    p_invoice_no: null,
    p_client_id: null,
    p_customer_name: "Rollback test",
    p_payment_status: "Paid",
    p_due_date: "2026-09-06",
    p_notes: null,
    p_payment_method: "Cash",
    p_sales_rep_id: null,
    p_amount_received: 100,
    p_lines: [
      { product_id: product.id, quantity: 1, unit_price: 10 },
      { product_id: product.id, quantity: 99999, unit_price: 10 },
    ],
    p_payment_request_id: null,
    p_paid_amount: null,
    p_paystack_reference: null,
    p_paid_at: null,
  });
  assert(error, "second line must fail checkout");
  assert(/stock|cannot sell/i.test(error.message), `unexpected error: ${error.message}`);

  const { rows: stockRows } = await pgClient.query(
    `SELECT current_stock FROM finished_products WHERE id = $1`,
    [product.id],
  );
  assert(Number(stockRows[0]?.current_stock) === beforeStock, "stock unchanged after rollback");

  const { rows: orphanIncome } = await pgClient.query(
    `
    SELECT count(*)::int AS cnt
    FROM income_register
    WHERE tenant_id = $1
      AND customer_name = 'Rollback test'
      AND date = '2026-09-06'
    `,
    [DAVORS],
  );
  assert((orphanIncome[0]?.cnt ?? 0) === 0, "no orphan income rows after failed checkout");

  console.log("PASS POS checkout full rollback on mid-cart failure");
}

async function testMomoFulfillmentAtomic(admin, pgClient) {
  const product = await pickProductWithStock(pgClient, 1);
  const snapshot = {
    saleDate: "2026-09-06",
    clientId: null,
    customerName: "MoMo atomic test",
    notes: null,
    dueDate: "2026-09-06",
    lines: [
      {
        id: "line-1",
        productId: product.id,
        productCode: product.product_code,
        productName: "Test",
        unitOfMeasure: "unit",
        quantity: 1,
        unitPrice: 15,
      },
    ],
  };

  const { rows: inserted } = await pgClient.query(
    `
    INSERT INTO product_sale_payment_requests (
      tenant_id, invoice_no, income_ids, amount_requested, status, payment_method, cart_snapshot
    ) VALUES (
      $1, $2, '{}'::uuid[], 15, 'pending', 'Mobile Money', $3::jsonb
    )
    RETURNING id
    `,
    [DAVORS, `MOMO-PENDING-test-${Date.now()}`, JSON.stringify(snapshot)],
  );
  const requestId = inserted[0].id;

  const { data, error } = await admin.rpc("checkout_pos_cart", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_sale_date: snapshot.saleDate,
    p_invoice_no: null,
    p_client_id: null,
    p_customer_name: snapshot.customerName,
    p_payment_status: "Paid",
    p_due_date: snapshot.dueDate,
    p_notes: "Payment method: Mobile Money",
    p_payment_method: "Mobile Money",
    p_sales_rep_id: null,
    p_amount_received: 15,
    p_lines: [{ product_id: product.id, quantity: 1, unit_price: 15 }],
    p_payment_request_id: requestId,
    p_paid_amount: 15,
    p_paystack_reference: `TEST-REF-${Date.now()}`,
    p_paid_at: new Date().toISOString(),
  });
  assert(!error, error?.message ?? "momo checkout failed");
  assert((data?.income_ids ?? []).length === 1, "one income id");

  const { rows: reqRows } = await pgClient.query(
    `SELECT status, cardinality(income_ids) AS income_count FROM product_sale_payment_requests WHERE id = $1`,
    [requestId],
  );
  assert(reqRows[0]?.status === "paid", "payment request marked paid");
  assert(Number(reqRows[0]?.income_count) === 1, "payment request income_ids set");

  console.log("PASS MoMo fulfillment atomic via checkout_pos_cart");
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  assert(url.includes(STAGING_REF) && dbUrl.includes(STAGING_REF), "not staging env");

  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();
  const admin = createClient(url, key, { auth: { persistSession: false } });

  try {
    await ensureMigrations(pgClient);
    await testInvoiceCreateEditStatusVoid(admin, pgClient);
    await testInvoiceAtomicityOnTaxFailure(admin, pgClient);
    await testPosCheckoutSuccess(admin, pgClient);
    await testPosCheckoutRollback(admin, pgClient);
    await testMomoFulfillmentAtomic(admin, pgClient);
    console.log("\n=== ALL STAGING TESTS PASS ===");
  } finally {
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
