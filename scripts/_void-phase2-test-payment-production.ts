/**
 * Void the Phase 2 test payment on production DF-INV-0001 / DF-RCPT-0001.
 * Usage: npx tsx scripts/_void-phase2-test-payment-production.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { voidClientInvoicePayment } from "../utils/client-invoice-payments-api";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

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

async function main() {
  loadEnvForce(resolve(".env.local.backup"));
  const ref = /^https?:\/\/([^.]+)\.supabase\.co/.exec(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  )?.[1];
  if (ref !== PRODUCTION_REF) {
    throw new Error(`Expected production ref ${PRODUCTION_REF}, got ${ref}`);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: receipt, error: receiptError } = await admin
    .from("client_receipts")
    .select("id, receipt_number, payment_id, amount, invoice:client_invoices!client_receipts_invoice_id_fkey(invoice_number, amount_received, status, total_amount_due)")
    .eq("tenant_id", DAVORS)
    .eq("receipt_number", "DF-RCPT-0001")
    .maybeSingle();

  if (receiptError) throw new Error(receiptError.message);
  if (!receipt?.payment_id) {
    console.log("DF-RCPT-0001 not found — may already be voided.");
    return;
  }

  console.log("Before void:");
  console.log("  receipt:", receipt.receipt_number, "amount:", receipt.amount);
  console.log("  invoice:", receipt.invoice?.invoice_number);
  console.log("  invoice amount_received:", receipt.invoice?.amount_received);
  console.log("  invoice status:", receipt.invoice?.status);

  const result = await voidClientInvoicePayment(admin, DAVORS, receipt.payment_id);
  if (result.error) {
    throw new Error(result.error);
  }

  const { data: receiptAfter } = await admin
    .from("client_receipts")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("receipt_number", "DF-RCPT-0001")
    .maybeSingle();

  const { data: paymentAfter } = await admin
    .from("client_invoice_payments")
    .select("id")
    .eq("id", receipt.payment_id)
    .maybeSingle();

  console.log("\nVoid result:");
  console.log("  voided receipt:", result.voidedReceiptNumber);
  console.log("  payment row exists:", Boolean(paymentAfter));
  console.log("  receipt row exists:", Boolean(receiptAfter));
  console.log("  invoice:", result.invoice?.invoice_number);
  console.log("  invoice amount_received:", result.invoice?.amount_received);
  console.log("  invoice status:", result.invoice?.status);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
