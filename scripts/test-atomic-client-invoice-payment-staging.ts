/**
 * Staging soak + atomicity + parity tests for atomic client invoice payment RPCs.
 *
 *   npx tsx scripts/test-atomic-client-invoice-payment-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { calculateIncomeOutstanding } from "../app/dashboard/finance/income-register-utils";
import { buildIncomeTaxLedgerRows } from "../app/dashboard/finance/tax-ledger-sync";
import {
  computeClientInvoiceCashOutstanding,
  deriveClientInvoiceStatusFromPayments,
} from "../utils/client-invoice-payment-utils";
import { roundMoney, toNumber } from "../utils/client-invoices-types";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const SQL_FILE = "scripts/280_atomic_client_invoice_payment.sql";
const TEST_TRIGGER = "trg_test_cip_atomicity_block_income";

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
    `SELECT count(*)::int AS cnt FROM pg_proc WHERE proname = 'record_client_invoice_payment'`,
  );
  if ((rows[0]?.cnt ?? 0) < 1) {
    const sql = readFileSync(resolve(SQL_FILE), "utf8");
    await pgClient.query(sql);
    console.log("Applied migration 280");
  }
}

async function findTestInvoice(admin, pgClient) {
  const { data, error } = await admin
    .from("client_invoices")
    .select(
      "id, invoice_number, status, total_amount_due, wht_amount, amount_received, tax_due, wht_rate, vat_nhil_getfund_rate, invoice_date, due_date, bill_to_name, client_id, business_unit_id",
    )
    .eq("tenant_id", DAVORS)
    .in("status", ["sent", "partial"])
    .gt("total_amount_due", 0)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    const { rows: payRows } = await pgClient.query(
      `SELECT coalesce(sum(amount), 0)::numeric AS total
       FROM client_invoice_payments
       WHERE tenant_id = $1 AND invoice_id = $2`,
      [DAVORS, row.id],
    );
    const paid = r2(payRows[0]?.total ?? 0);
    const remaining = computeClientInvoiceCashOutstanding(
      row.total_amount_due,
      row.wht_amount,
      paid,
    );
    if (remaining >= 10) {
      return { invoice: row, paid, remaining };
    }
  }

  throw new Error("No suitable sent/partial invoice with >= 10 GHS outstanding on staging.");
}

async function sumPayments(pgClient, invoiceId) {
  const { rows } = await pgClient.query(
    `SELECT coalesce(sum(amount), 0)::numeric AS total, count(*)::int AS cnt
     FROM client_invoice_payments WHERE tenant_id = $1 AND invoice_id = $2`,
    [DAVORS, invoiceId],
  );
  return { total: r2(rows[0]?.total ?? 0), count: rows[0]?.cnt ?? 0 };
}

async function getIncomeRow(pgClient, invoiceId, invoiceNumber) {
  const { rows } = await pgClient.query(
    `
    SELECT *
    FROM income_register
    WHERE tenant_id = $1
      AND (client_invoice_id = $2 OR (invoice_no = $3 AND service_category = 'Client Invoice'))
    ORDER BY client_invoice_id NULLS LAST
    LIMIT 1
    `,
    [DAVORS, invoiceId, invoiceNumber],
  );
  return rows[0] ?? null;
}

async function getTaxLegs(pgClient, incomeId) {
  const { rows } = await pgClient.query(
    `SELECT direction, tax_component, tax_amount, taxable_base, rate_pct
     FROM tax_ledger_entries
     WHERE source_type = 'income_register' AND source_id = $1
     ORDER BY direction, tax_component`,
    [incomeId],
  );
  return rows;
}

async function installAtomicityTrigger(pgClient, invoiceId) {
  await pgClient.query(`
    CREATE OR REPLACE FUNCTION public.${TEST_TRIGGER}_fn()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.client_invoice_id = '${invoiceId}'::uuid THEN
        RAISE EXCEPTION 'TEST_ATOMICITY_BLOCK';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await pgClient.query(`
    DROP TRIGGER IF EXISTS ${TEST_TRIGGER} ON public.income_register;
    CREATE TRIGGER ${TEST_TRIGGER}
      BEFORE INSERT OR UPDATE ON public.income_register
      FOR EACH ROW EXECUTE FUNCTION public.${TEST_TRIGGER}_fn();
  `);
}

async function removeAtomicityTrigger(pgClient) {
  await pgClient.query(`DROP TRIGGER IF EXISTS ${TEST_TRIGGER} ON public.income_register`);
  await pgClient.query(`DROP FUNCTION IF EXISTS public.${TEST_TRIGGER}_fn()`);
}

function expectParity(invoice, paymentAmount, paidBefore, incomeRow, taxLegs) {
  const expectedReceived = r2(paidBefore + paymentAmount);
  const expectedStatus = deriveClientInvoiceStatusFromPayments(
    expectedReceived,
    invoice.total_amount_due,
    invoice.wht_amount,
    invoice.status,
  );
  const expectedOutstanding = calculateIncomeOutstanding(
    toNumber(invoice.total_amount_due),
    expectedReceived,
    toNumber(invoice.wht_amount),
  );
  const outputVat = r2(invoice.tax_due);
  const whtAmount = r2(invoice.wht_amount);

  if (r2(invoice.amount_received) !== expectedReceived) {
    throw new Error(
      `Parity fail amount_received: got ${invoice.amount_received}, expected ${expectedReceived}`,
    );
  }
  if (invoice.status !== expectedStatus) {
    throw new Error(`Parity fail status: got ${invoice.status}, expected ${expectedStatus}`);
  }
  if (!incomeRow) {
    throw new Error("Parity fail: income_register row missing");
  }
  if (r2(incomeRow.amount_received) !== expectedReceived) {
    throw new Error(
      `Parity fail income amount_received: got ${incomeRow.amount_received}, expected ${expectedReceived}`,
    );
  }
  if (r2(incomeRow.outstanding_balance) !== expectedOutstanding) {
    throw new Error(
      `Parity fail income outstanding: got ${incomeRow.outstanding_balance}, expected ${expectedOutstanding}`,
    );
  }

  const entryDate =
    typeof invoice.invoice_date === "string"
      ? invoice.invoice_date.slice(0, 10)
      : new Date(invoice.invoice_date).toISOString().slice(0, 10);

  const expectedTaxRows = buildIncomeTaxLedgerRows({
    sourceId: incomeRow.id,
    entryDate,
    amount: toNumber(invoice.total_amount_due),
    whtRatePct: whtAmount > 0 ? r2(invoice.wht_rate) || null : null,
    whtAmount,
    outputTaxComponent: outputVat > 0 ? "vat_bundle" : null,
    outputTaxRatePct: outputVat > 0 ? r2(invoice.vat_nhil_getfund_rate) : null,
    outputVatAmount: outputVat,
    counterpartyName: invoice.bill_to_name,
    notes: `Invoice ${invoice.invoice_number}`,
    tenantId: DAVORS,
  });

  if (taxLegs.length !== expectedTaxRows.length) {
    throw new Error(
      `Parity fail tax leg count: got ${taxLegs.length}, expected ${expectedTaxRows.length}`,
    );
  }

  for (const expected of expectedTaxRows) {
    const match = taxLegs.find(
      (leg) =>
        leg.direction === expected.direction &&
        leg.tax_component === expected.tax_component,
    );
    if (!match) {
      throw new Error(`Parity fail: missing tax leg ${expected.direction}/${expected.tax_component}`);
    }
    if (r2(match.tax_amount) !== r2(expected.tax_amount)) {
      throw new Error(
        `Parity fail tax amount ${expected.tax_component}: got ${match.tax_amount}, expected ${expected.tax_amount}`,
      );
    }
  }
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.includes(STAGING_REF)) {
    throw new Error("Refusing: not staging DATABASE_URL");
  }

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
  let paymentId = null;
  let receiptId = null;
  let invoiceId = null;
  let paymentAmount = null;
  let paidBefore = null;
  let receiptCountBefore = 0;

  try {
    await ensureMigration(pgClient);
    const { invoice, paid, remaining } = await findTestInvoice(admin, pgClient);
    invoiceId = invoice.id;
    paidBefore = paid;
    paymentAmount = Math.min(10, remaining);

    const payBefore = await sumPayments(pgClient, invoiceId);
    const { rows: rcptBeforeRows } = await pgClient.query(
      `SELECT count(*)::int AS cnt FROM client_receipts WHERE tenant_id = $1 AND invoice_id = $2`,
      [DAVORS, invoiceId],
    );
    receiptCountBefore = rcptBeforeRows[0]?.cnt ?? 0;

    const incomeBefore = await getIncomeRow(pgClient, invoiceId, invoice.invoice_number);
    const taxBeforeCount = incomeBefore
      ? (
          await pgClient.query(
            `SELECT count(*)::int AS cnt FROM tax_ledger_entries WHERE source_type = 'income_register' AND source_id = $1`,
            [incomeBefore.id],
          )
        ).rows[0].cnt
      : 0;

    console.log(`Test invoice ${invoice.invoice_number} outstanding=${remaining} pay=${paymentAmount}`);

    // --- Soak: record payment ---
    const { data: recordData, error: recordError } = await admin.rpc(
      "record_client_invoice_payment",
      {
        p_tenant_id: DAVORS,
        p_invoice_id: invoiceId,
        p_payment_date: new Date().toISOString().slice(0, 10),
        p_amount: paymentAmount,
        p_payment_method: "Bank Transfer",
        p_notes: "atomic-cip-staging-test",
        p_recorded_by: null,
      },
    );
    if (recordError) throw new Error(`Record RPC failed: ${recordError.message}`);

    paymentId = recordData?.payment?.id;
    receiptId = recordData?.receipt?.id;
    if (!paymentId || !receiptId) {
      throw new Error("Record RPC missing payment/receipt ids");
    }

    const payAfter = await sumPayments(pgClient, invoiceId);
    if (payAfter.count !== payBefore.count + 1) {
      throw new Error(`Expected +1 payment, got ${payAfter.count - payBefore.count}`);
    }
    if (payAfter.total !== r2(paidBefore + paymentAmount)) {
      throw new Error(`Payment sum mismatch: ${payAfter.total}`);
    }

    const { rows: invRows } = await pgClient.query(
      `SELECT * FROM client_invoices WHERE id = $1`,
      [invoiceId],
    );
    const updatedInvoice = invRows[0];
    const incomeRow = await getIncomeRow(pgClient, invoiceId, invoice.invoice_number);
    const taxLegs = incomeRow ? await getTaxLegs(pgClient, incomeRow.id) : [];

    expectParity(updatedInvoice, paymentAmount, paidBefore, incomeRow, taxLegs);
    results.push("PASS soak record payment + parity");

    const { rows: rcptAfterRows } = await pgClient.query(
      `SELECT count(*)::int AS cnt FROM client_receipts WHERE tenant_id = $1 AND invoice_id = $2`,
      [DAVORS, invoiceId],
    );
    if (rcptAfterRows[0].cnt !== receiptCountBefore + 1) {
      throw new Error("Receipt count did not increase by 1");
    }
    results.push("PASS receipt created");

    // --- Atomicity: forced income_register failure rolls back all writes ---
    await installAtomicityTrigger(pgClient, invoiceId);
    const snapBeforeFail = {
      payments: await sumPayments(pgClient, invoiceId),
      receipts: rcptAfterRows[0].cnt,
      amountReceived: updatedInvoice.amount_received,
    };

    const { error: failError } = await admin.rpc("record_client_invoice_payment", {
      p_tenant_id: DAVORS,
      p_invoice_id: invoiceId,
      p_payment_date: new Date().toISOString().slice(0, 10),
      p_amount: 1,
      p_payment_method: "Bank Transfer",
      p_notes: "should-rollback",
      p_recorded_by: null,
    });

    await removeAtomicityTrigger(pgClient);

    if (!failError || !/TEST_ATOMICITY_BLOCK/i.test(failError.message)) {
      throw new Error(`Expected TEST_ATOMICITY_BLOCK, got: ${failError?.message ?? "no error"}`);
    }

    const snapAfterFail = {
      payments: await sumPayments(pgClient, invoiceId),
      receipts: (
        await pgClient.query(
          `SELECT count(*)::int AS cnt FROM client_receipts WHERE tenant_id = $1 AND invoice_id = $2`,
          [DAVORS, invoiceId],
        )
      ).rows[0].cnt,
      amountReceived: (
        await pgClient.query(`SELECT amount_received FROM client_invoices WHERE id = $1`, [
          invoiceId,
        ])
      ).rows[0].amount_received,
    };

    if (snapAfterFail.payments.count !== snapBeforeFail.payments.count) {
      throw new Error("Atomicity fail: payment row committed after forced error");
    }
    if (snapAfterFail.receipts !== snapBeforeFail.receipts) {
      throw new Error("Atomicity fail: receipt row committed after forced error");
    }
    if (r2(snapAfterFail.amountReceived) !== r2(snapBeforeFail.amountReceived)) {
      throw new Error("Atomicity fail: invoice amount_received changed after forced error");
    }
    results.push("PASS atomicity full rollback on mid-flight failure");

    // --- Void payment ---
    const { data: voidData, error: voidError } = await admin.rpc(
      "void_client_invoice_payment",
      {
        p_tenant_id: DAVORS,
        p_payment_id: paymentId,
      },
    );
    if (voidError) throw new Error(`Void RPC failed: ${voidError.message}`);

    const payAfterVoid = await sumPayments(pgClient, invoiceId);
    if (payAfterVoid.count !== payBefore.count) {
      throw new Error(`After void expected ${payBefore.count} payments, got ${payAfterVoid.count}`);
    }
    if (payAfterVoid.total !== paidBefore) {
      throw new Error(`After void payment sum ${payAfterVoid.total} != ${paidBefore}`);
    }

    const { rows: rcptVoidRows } = await pgClient.query(
      `SELECT count(*)::int AS cnt FROM client_receipts WHERE tenant_id = $1 AND invoice_id = $2`,
      [DAVORS, invoiceId],
    );
    if (rcptVoidRows[0].cnt !== receiptCountBefore) {
      throw new Error("Receipt not cascaded on void");
    }

    const { rows: invVoidRows } = await pgClient.query(
      `SELECT amount_received, status FROM client_invoices WHERE id = $1`,
      [invoiceId],
    );
    const expectedStatusAfterVoid = deriveClientInvoiceStatusFromPayments(
      paidBefore,
      invoice.total_amount_due,
      invoice.wht_amount,
      invoice.status,
    );
    if (r2(invVoidRows[0].amount_received) !== r2(paidBefore)) {
      throw new Error("Invoice amount_received not restored after void");
    }
    if (invVoidRows[0].status !== expectedStatusAfterVoid) {
      throw new Error(
        `Invoice status after void ${invVoidRows[0].status} != ${expectedStatusAfterVoid}`,
      );
    }

    const incomeAfterVoid = await getIncomeRow(pgClient, invoiceId, invoice.invoice_number);
    if (incomeAfterVoid && r2(incomeAfterVoid.amount_received) !== r2(paidBefore)) {
      throw new Error("Income register not synced after void");
    }

    if (!voidData?.voided_receipt_number) {
      throw new Error("Void RPC missing voided_receipt_number");
    }
    results.push("PASS void payment atomic reversal");

    console.log("\n=== RESULTS ===");
    for (const r of results) console.log(r);
    console.log(`\n${results.length}/${results.length} PASS`);
  } finally {
    await removeAtomicityTrigger(pgClient).catch(() => {});
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
