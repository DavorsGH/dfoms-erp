/**
 * Refresh Client Invoice status for net-of-WHT settled invoices (production).
 *
 * Targets: DF-INV-0001, DF-INV-0002 (Davors tenant).
 * Status-only refresh via recomputeClientInvoiceFromPayments — amount_received unchanged.
 *
 * Usage:
 *   npx tsx scripts/_refresh-df-inv-wht-status-production.ts
 *   npx tsx scripts/_refresh-df-inv-wht-status-production.ts --commit
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { deriveClientInvoiceStatusFromPayments } from "../utils/client-invoice-payment-utils";
import {
  recomputeClientInvoiceFromPayments,
} from "../utils/client-invoice-payments-api";
import { roundMoney, toNumber } from "../utils/client-invoices-types";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TARGET_INVOICE_NUMBERS = ["DF-INV-0001", "DF-INV-0002"] as const;

const INVOICE_SELECT =
  "id, invoice_number, total_amount_due, wht_rate, wht_amount, amount_received, status";

const INCOME_SELECT =
  "id, invoice_no, amount_received, outstanding_balance, payment_status";

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

function printInvoiceStatusReport(invoice) {
  const cashReceived = roundMoney(toNumber(invoice.amount_received));
  const totalDue = roundMoney(toNumber(invoice.total_amount_due));
  const whtAmount = roundMoney(toNumber(invoice.wht_amount));
  const computedStatus = deriveClientInvoiceStatusFromPayments(
    cashReceived,
    totalDue,
    whtAmount,
    invoice.status,
  );

  console.log(`  invoice_number:     ${invoice.invoice_number}`);
  console.log(`  total_amount_due:   ${formatMoney(totalDue)}`);
  console.log(`  wht_amount:         ${formatMoney(whtAmount)}`);
  console.log(`  amount_received:    ${formatMoney(cashReceived)} (unchanged)`);
  console.log(`  current status:     ${invoice.status}`);
  console.log(`  computed status:    ${computedStatus}`);
  console.log(
    `  settled check:      cash (${formatMoney(cashReceived)}) + wht (${formatMoney(whtAmount)}) >= total (${formatMoney(totalDue)}) → ${cashReceived + whtAmount >= totalDue - 0.009}`,
  );

  return computedStatus;
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
    const income = await loadIncomeRegister(admin, invoice);

    printInvoiceStatusReport(invoice);

    console.log("\n  income_register (current):");
    if (!income) {
      console.log("    (no linked row)");
    } else {
      console.log(`    payment_status:     ${income.payment_status}`);
      console.log(`    amount_received:    ${formatMoney(income.amount_received)}`);
      console.log(`    outstanding_balance:${formatMoney(income.outstanding_balance)}`);
    }
    console.log("");
  }
}

async function runCommit(admin) {
  console.log("=== COMMIT MODE (status refresh only) ===");
  console.log(`Tenant: ${DAVORS}`);
  console.log(`Invoices: ${TARGET_INVOICE_NUMBERS.join(", ")}\n`);

  for (const invoiceNumber of TARGET_INVOICE_NUMBERS) {
    console.log("--------------------------------------------------");
    console.log(invoiceNumber);
    console.log("--------------------------------------------------");

    const before = await loadInvoice(admin, invoiceNumber);
    const computedBefore = printInvoiceStatusReport(before);

    if (before.status === computedBefore) {
      console.log(`\n  Skipping recompute — status already ${before.status}.`);
      continue;
    }

    console.log(`\n  Recomputing status ${before.status} → ${computedBefore}…`);

    const { data: fullInvoice, error: loadError } = await admin
      .from("client_invoices")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("invoice_number", invoiceNumber)
      .maybeSingle();

    if (loadError || !fullInvoice) {
      throw new Error(`${invoiceNumber}: unable to load full invoice for recompute`);
    }

    const result = await recomputeClientInvoiceFromPayments(admin, DAVORS, fullInvoice);
    if (result.error || !result.invoice) {
      throw new Error(`${invoiceNumber}: recompute failed: ${result.error ?? "unknown"}`);
    }

    console.log(`  updated status:     ${result.invoice.status}`);
    console.log(
      `  amount_received:    ${formatMoney(result.invoice.amount_received)} (should match before)`,
    );
  }

  console.log("\n=== FINAL STATE ===");
  for (const invoiceNumber of TARGET_INVOICE_NUMBERS) {
    const invoice = await loadInvoice(admin, invoiceNumber);
    const income = await loadIncomeRegister(admin, invoice);

    console.log("--------------------------------------------------");
    console.log(invoiceNumber);
    console.log("--------------------------------------------------");
    printInvoiceStatusReport(invoice);
    console.log("\n  income_register:");
    if (!income) {
      console.log("    (no linked row)");
    } else {
      console.log(`    payment_status:     ${income.payment_status}`);
      console.log(`    amount_received:    ${formatMoney(income.amount_received)}`);
      console.log(`    outstanding_balance:${formatMoney(income.outstanding_balance)}`);
    }
    console.log("");
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
    console.log("Dry run complete. Re-run with --commit to refresh status.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
