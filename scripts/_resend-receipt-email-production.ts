/**
 * Re-send receipt_issued email for an existing production receipt (no new payment).
 * Usage: npx tsx scripts/_resend-receipt-email-production.ts --to david.avors@gmail.com
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DEFAULT_TO = "david.avors@gmail.com";

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

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function withCustomerEmail(admin, clientId, to, fn) {
  const { data: customer, error } = await admin
    .from("customers")
    .select("email")
    .eq("tenant_id", DAVORS)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const originalEmail = customer?.email ?? null;
  await admin
    .from("customers")
    .update({ email: to })
    .eq("tenant_id", DAVORS)
    .eq("client_id", clientId);

  try {
    await fn();
  } finally {
    if (originalEmail !== null) {
      await admin
        .from("customers")
        .update({ email: originalEmail })
        .eq("tenant_id", DAVORS)
        .eq("client_id", clientId);
    }
  }
}

async function main() {
  const to = (argValue("--to") ?? DEFAULT_TO).trim();
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

  const { data: receipt, error } = await admin
    .from("client_receipts")
    .select(
      "id, receipt_number, receipt_date, amount, invoice:client_invoices!client_receipts_invoice_id_fkey(invoice_number, bill_to_name, client_id)",
    )
    .eq("tenant_id", DAVORS)
    .eq("receipt_number", "DF-RCPT-0001")
    .maybeSingle();

  if (error || !receipt) {
    throw new Error(error?.message ?? "DF-RCPT-0001 not found.");
  }

  const invoiceNumber = receipt.invoice?.invoice_number ?? "";
  const clientId = receipt.invoice?.client_id ?? "";
  const customerName =
    receipt.invoice?.bill_to_name?.trim() || clientId;

  if (!clientId) {
    throw new Error("Receipt invoice is missing client_id.");
  }

  const { notifyClientReceiptIssued } = await import(
    "../utils/client-document-notifications.ts"
  );

  await withCustomerEmail(admin, clientId, to, async () => {
    await notifyClientReceiptIssued({
      tenantId: DAVORS,
      clientId,
      receiptId: receipt.id,
      receiptNumber: receipt.receipt_number,
      invoiceNumber,
      customerName,
      amount: String(receipt.amount ?? ""),
      paymentDate: receipt.receipt_date ?? "",
    });
  });

  console.log(
    `receipt_issued re-sent for ${receipt.receipt_number} on ${invoiceNumber} -> ${to}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
