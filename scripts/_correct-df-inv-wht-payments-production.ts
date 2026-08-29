/**
 * Correct gross Client Invoice payments to net-of-WHT on production.
 *
 * Targets: DF-INV-0001, DF-INV-0002 (Davors tenant).
 *
 * Usage:
 *   npx tsx scripts/_correct-df-inv-wht-payments-production.ts
 *   npx tsx scripts/_correct-df-inv-wht-payments-production.ts --commit
 *   npx tsx scripts/_correct-df-inv-wht-payments-production.ts --env-file .env.local.backup
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  recordClientInvoicePayment,
  voidClientInvoicePayment,
} from "../utils/client-invoice-payments-api";
import { roundMoney, toNumber } from "../utils/client-invoices-types";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TARGET_INVOICE_NUMBERS = ["DF-INV-0001", "DF-INV-0002"] as const;

const CORRECTION_NOTE =
  "Corrected: re-recorded at net-of-WHT amount, original gross payment voided";

const INVOICE_SELECT =
  "id, invoice_number, total_amount_due, wht_rate, wht_amount, amount_received, status";

const PAYMENT_SELECT =
  "id, invoice_id, payment_date, amount, payment_method, notes, created_at";

const INCOME_SELECT =
  "id, invoice_no, client_invoice_id, amount, amount_received, outstanding_balance, wht_rate, wht_amount, payment_status, date";

const TAX_LEDGER_SELECT =
  "id, entry_date, direction, tax_component, rate_pct, taxable_base, tax_amount, status, source_type, source_id, notes";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function resolveEnvFile(argv) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) {
    return argv[idx + 1];
  }
  return ".env.local.backup";
}

function formatMoney(value) {
  return roundMoney(toNumber(value)).toFixed(2);
}

function computeNetPaymentAmount(invoice) {
  const totalDue = roundMoney(toNumber(invoice.total_amount_due));
  const whtAmount = roundMoney(toNumber(invoice.wht_amount));
  return roundMoney(totalDue - whtAmount);
}

async function loadInvoice(admin, invoiceNumber) {
  const { data, error } = await admin
    .from("client_invoices")
    .select(INVOICE_SELECT)
    .eq("tenant_id", DAVORS)
    .eq("invoice_number", invoiceNumber)
    .maybeSingle();

  if (error) {
    throw new Error(`${invoiceNumber}: ${error.message}`);
  }

  if (!data) {
    throw new Error(`${invoiceNumber}: invoice not found`);
  }

  return data;
}

async function loadPayments(admin, invoiceId) {
  const { data, error } = await admin
    .from("client_invoice_payments")
    .select(PAYMENT_SELECT)
    .eq("tenant_id", DAVORS)
    .eq("invoice_id", invoiceId)
    .order("payment_date", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`payments for ${invoiceId}: ${error.message}`);
  }

  return data ?? [];
}

async function loadIncomeRegister(admin, invoice) {
  const { data: byId, error: byIdError } = await admin
    .from("income_register")
    .select(INCOME_SELECT)
    .eq("tenant_id", DAVORS)
    .eq("client_invoice_id", invoice.id)
    .maybeSingle();

  if (byIdError) {
    throw new Error(`income_register for ${invoice.invoice_number}: ${byIdError.message}`);
  }

  if (byId) {
    return byId;
  }

  const { data, error } = await admin
    .from("income_register")
    .select(INCOME_SELECT)
    .eq("tenant_id", DAVORS)
    .eq("invoice_no", invoice.invoice_number)
    .maybeSingle();

  if (error) {
    throw new Error(`income_register for ${invoice.invoice_number}: ${error.message}`);
  }

  return data;
}

async function loadTaxLedger(admin, incomeId) {
  if (!incomeId) {
    return [];
  }

  const { data, error } = await admin
    .from("tax_ledger_entries")
    .select(TAX_LEDGER_SELECT)
    .eq("tenant_id", DAVORS)
    .eq("source_type", "income_register")
    .eq("source_id", incomeId)
    .order("entry_date", { ascending: true });

  if (error) {
    throw new Error(`tax_ledger_entries for ${incomeId}: ${error.message}`);
  }

  return data ?? [];
}

function printInvoiceHeader(invoice) {
  console.log(`  invoice_number:     ${invoice.invoice_number}`);
  console.log(`  total_amount_due:   ${formatMoney(invoice.total_amount_due)}`);
  console.log(`  wht_rate:           ${invoice.wht_rate ?? "—"}`);
  console.log(`  wht_amount:         ${formatMoney(invoice.wht_amount)}`);
  console.log(`  amount_received:    ${formatMoney(invoice.amount_received)}`);
  console.log(`  status:             ${invoice.status}`);
}

function printPayments(payments) {
  if (payments.length === 0) {
    console.log("  (no client_invoice_payments rows)");
    return;
  }

  for (const payment of payments) {
    console.log(`  - payment_id:       ${payment.id}`);
    console.log(`    amount:           ${formatMoney(payment.amount)}`);
    console.log(`    payment_date:     ${payment.payment_date}`);
    console.log(`    payment_method:   ${payment.payment_method ?? "—"}`);
    console.log(`    notes:            ${payment.notes ?? "—"}`);
  }
}

function printBeforeAfter(invoice, payments) {
  const totalRecorded = roundMoney(
    payments.reduce((sum, row) => sum + toNumber(row.amount), 0),
  );
  const correctNet = computeNetPaymentAmount(invoice);
  const difference = roundMoney(totalRecorded - correctNet);

  console.log("  BEFORE / AFTER:");
  console.log(`    current recorded total:  ${formatMoney(totalRecorded)}`);
  console.log(`    correct net amount:      ${formatMoney(correctNet)}`);
  console.log(`    difference (overstate):  ${formatMoney(difference)}`);
  console.log(
    `    formula: total_amount_due (${formatMoney(invoice.total_amount_due)}) - wht_amount (${formatMoney(invoice.wht_amount)})`,
  );
}

function printRelatedState(label, invoice, income, taxLegs) {
  console.log(`\n${label}`);
  console.log("client_invoices:");
  printInvoiceHeader(invoice);

  console.log("income_register:");
  if (!income) {
    console.log("  (no linked income_register row)");
  } else {
    console.log(`  id:                   ${income.id}`);
    console.log(`  invoice_no:           ${income.invoice_no}`);
    console.log(`  amount:               ${formatMoney(income.amount)}`);
    console.log(`  amount_received:      ${formatMoney(income.amount_received)}`);
    console.log(`  outstanding_balance:  ${formatMoney(income.outstanding_balance)}`);
    console.log(`  wht_amount:           ${formatMoney(income.wht_amount)}`);
    console.log(`  payment_status:       ${income.payment_status}`);
    console.log(`  date:                 ${income.date}`);
  }

  console.log("tax_ledger_entries:");
  if (taxLegs.length === 0) {
    console.log("  (none linked to income_register)");
  } else {
    for (const leg of taxLegs) {
      console.log(
        `  - ${leg.direction}/${leg.tax_component}: amount=${formatMoney(leg.tax_amount)} status=${leg.status} date=${leg.entry_date}`,
      );
    }
  }
}

async function runDryRun(admin) {
  console.log("=== DRY RUN (no writes) ===");
  console.log(`Tenant: ${DAVORS}`);
  console.log(`Invoices: ${TARGET_INVOICE_NUMBERS.join(", ")}\n`);

  for (const invoiceNumber of TARGET_INVOICE_NUMBERS) {
    console.log("--------------------------------------------------");
    console.log(invoiceNumber);
    console.log("--------------------------------------------------");

    const invoice = await loadInvoice(admin, invoiceNumber);
    const payments = await loadPayments(admin, invoice.id);

    console.log("\nclient_invoices:");
    printInvoiceHeader(invoice);

    console.log("\nclient_invoice_payments:");
    printPayments(payments);

    console.log("");
    printBeforeAfter(invoice, payments);
    console.log("");
  }
}

async function runCommit(admin) {
  console.log("=== COMMIT MODE ===");
  console.log(`Tenant: ${DAVORS}`);
  console.log(`Invoices: ${TARGET_INVOICE_NUMBERS.join(", ")}\n`);

  for (const invoiceNumber of TARGET_INVOICE_NUMBERS) {
    console.log("--------------------------------------------------");
    console.log(invoiceNumber);
    console.log("--------------------------------------------------");

    const invoice = await loadInvoice(admin, invoiceNumber);
    const payments = await loadPayments(admin, invoice.id);
    const correctNet = computeNetPaymentAmount(invoice);

    console.log("\nPre-commit snapshot:");
    printInvoiceHeader(invoice);
    printBeforeAfter(invoice, payments);

    if (payments.length === 0) {
      throw new Error(`${invoiceNumber}: no payments to void`);
    }

    if (correctNet <= 0) {
      throw new Error(
        `${invoiceNumber}: computed net payment ${formatMoney(correctNet)} is not positive`,
      );
    }

    const totalRecorded = roundMoney(
      payments.reduce((sum, row) => sum + toNumber(row.amount), 0),
    );

    if (Math.abs(totalRecorded - correctNet) < 0.01) {
      console.log(
        `\nSkipping ${invoiceNumber}: payments already equal net amount (${formatMoney(correctNet)}).`,
      );
      continue;
    }

    const templatePayment = payments[0];

    for (const payment of payments) {
      console.log(`\nVoiding payment ${payment.id} (${formatMoney(payment.amount)})…`);
      const voidResult = await voidClientInvoicePayment(admin, DAVORS, payment.id);
      if (voidResult.error) {
        throw new Error(`${invoiceNumber}: void failed for ${payment.id}: ${voidResult.error}`);
      }
      console.log(
        `  voided receipt: ${voidResult.voidedReceiptNumber ?? "—"} | invoice status: ${voidResult.invoice?.status}`,
      );
    }

    console.log(
      `\nRe-recording net payment ${formatMoney(correctNet)} on ${templatePayment.payment_date}…`,
    );
    const recordResult = await recordClientInvoicePayment(
      admin,
      DAVORS,
      invoice.id,
      {
        payment_date: templatePayment.payment_date,
        amount: correctNet,
        payment_method: templatePayment.payment_method,
        notes: CORRECTION_NOTE,
      },
      null,
    );

    if (recordResult.error || !recordResult.invoice) {
      throw new Error(
        `${invoiceNumber}: re-record failed: ${recordResult.error ?? "missing invoice"}`,
      );
    }

    console.log(`  new payment_id: ${recordResult.payment?.id ?? "—"}`);
    console.log(`  new receipt:    ${recordResult.receipt?.receipt_number ?? "—"}`);
    console.log(
      `  invoice status: ${recordResult.invoice.status} | amount_received: ${formatMoney(recordResult.invoice.amount_received)}`,
    );
  }

  console.log("\n=== FINAL STATE ===");
  for (const invoiceNumber of TARGET_INVOICE_NUMBERS) {
    const invoice = await loadInvoice(admin, invoiceNumber);
    const income = await loadIncomeRegister(admin, invoice);
    const taxLegs = await loadTaxLedger(admin, income?.id ?? null);
    printRelatedState(invoiceNumber, invoice, income, taxLegs);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const commit = argv.includes("--commit");
  const envFile = resolveEnvFile(argv);

  loadEnvForce(resolve(process.cwd(), envFile));

  const ref = /^https?:\/\/([^.]+)\.supabase\.co/.exec(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  )?.[1];

  if (ref !== PRODUCTION_REF) {
    throw new Error(
      `Expected production ref ${PRODUCTION_REF}, got ${ref ?? "unknown"} (env: ${envFile})`,
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  if (commit) {
    await runCommit(admin);
  } else {
    await runDryRun(admin);
    console.log("\nDry run complete. Re-run with --commit to apply changes.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
