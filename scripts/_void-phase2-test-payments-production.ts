/**
 * Void Phase 2 test payments on production DF-INV-0001 (DF-RCPT-0002, DF-RCPT-0003).
 * Usage: npx tsx scripts/_void-phase2-test-payments-production.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { voidClientInvoicePayment } from "../utils/client-invoice-payments-api";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const INVOICE_NUMBER = "DF-INV-0001";
const RECEIPT_NUMBERS = ["DF-RCPT-0002", "DF-RCPT-0003"];

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

async function voidReceipt(admin, receiptNumber) {
  const { data: receipt, error: receiptError } = await admin
    .from("client_receipts")
    .select(
      "id, receipt_number, payment_id, amount, invoice:client_invoices!client_receipts_invoice_id_fkey(invoice_number, amount_received, status, total_amount_due)",
    )
    .eq("tenant_id", DAVORS)
    .eq("receipt_number", receiptNumber)
    .maybeSingle();

  if (receiptError) throw new Error(receiptError.message);
  if (!receipt?.payment_id) {
    console.log(`${receiptNumber}: not found or already voided`);
    return null;
  }

  console.log(`\nVoiding ${receiptNumber} (payment ${receipt.payment_id})...`);
  console.log("  invoice amount_received before:", receipt.invoice?.amount_received);
  console.log("  invoice status before:", receipt.invoice?.status);

  const result = await voidClientInvoicePayment(admin, DAVORS, receipt.payment_id);
  if (result.error) {
    throw new Error(`${receiptNumber}: ${result.error}`);
  }

  const { data: receiptAfter } = await admin
    .from("client_receipts")
    .select("id")
    .eq("tenant_id", DAVORS)
    .eq("receipt_number", receiptNumber)
    .maybeSingle();

  console.log("  voided:", result.voidedReceiptNumber);
  console.log("  receipt row exists after:", Boolean(receiptAfter));
  console.log("  invoice amount_received after:", result.invoice?.amount_received);
  console.log("  invoice status after:", result.invoice?.status);

  return result;
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

  for (const receiptNumber of RECEIPT_NUMBERS) {
    await voidReceipt(admin, receiptNumber);
  }

  const { data: invoice, error: invoiceError } = await admin
    .from("client_invoices")
    .select("invoice_number, amount_received, status, total_amount_due")
    .eq("tenant_id", DAVORS)
    .eq("invoice_number", INVOICE_NUMBER)
    .maybeSingle();

  if (invoiceError) throw new Error(invoiceError.message);

  const { data: remainingReceipts } = await admin
    .from("client_receipts")
    .select("receipt_number")
    .eq("tenant_id", DAVORS)
    .in("receipt_number", RECEIPT_NUMBERS);

  console.log("\n=== Final state ===");
  console.log("  invoice:", invoice?.invoice_number);
  console.log("  amount_received:", invoice?.amount_received);
  console.log("  status:", invoice?.status);
  console.log(
    "  remaining test receipts:",
    remainingReceipts?.length ? remainingReceipts.map((r) => r.receipt_number).join(", ") : "(none)",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
