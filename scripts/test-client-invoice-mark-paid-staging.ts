/**
 * Staging verification: draft → sent → paid updates income_register via invoice_no.
 *
 * Usage: npx tsx scripts/test-client-invoice-mark-paid-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  updateClientInvoiceStatus,
} from "../utils/client-invoices-api";

function loadEnvForce(filePath: string) {
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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";

function projectRef(url: string) {
  return new URL(url).hostname.split(".")[0];
}

async function loadIncomeRow(
  admin: ReturnType<typeof createClient>,
  invoiceNumber: string,
) {
  const { data, error } = await admin
    .from("income_register")
    .select(
      "id, invoice_no, service_category, amount, amount_received, outstanding_balance, payment_status",
    )
    .eq("tenant_id", DAVORS)
    .eq("invoice_no", invoiceNumber)
    .eq("service_category", "Client Invoice")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) {
    throw new Error("Missing staging Supabase env");
  }
  if (projectRef(url) !== STAGING_REF) {
    throw new Error(`Refusing non-staging project: ${projectRef(url)}`);
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: draftInvoice, error: draftError } = await admin
    .from("client_invoices")
    .select("id, invoice_number, status, total_amount_due, amount_received")
    .eq("tenant_id", DAVORS)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftError || !draftInvoice) {
    throw new Error(draftError?.message ?? "No draft invoice on staging");
  }

  console.log("Using draft invoice:", draftInvoice);

  const beforeIncome = await loadIncomeRow(admin, draftInvoice.invoice_number);
  console.log("Income before send:", beforeIncome);

  const sentResult = await updateClientInvoiceStatus(
    admin,
    DAVORS,
    draftInvoice.id,
    "sent",
  );
  if (sentResult.error || !sentResult.invoice) {
    throw new Error(sentResult.error ?? "Send failed");
  }

  const sentIncome = await loadIncomeRow(admin, sentResult.invoice.invoice_number);
  console.log("Income after send:", sentIncome);

  if (!sentIncome) {
    throw new Error("Expected income_register row after marking invoice as sent");
  }
  if (Number(sentIncome.amount) !== Number(draftInvoice.total_amount_due)) {
    throw new Error(
      `Income amount mismatch: ${sentIncome.amount} vs ${draftInvoice.total_amount_due}`,
    );
  }
  if (sentIncome.payment_status !== "Pending" && sentIncome.payment_status !== "Overdue") {
    throw new Error(`Unexpected payment_status after send: ${sentIncome.payment_status}`);
  }

  const paidResult = await updateClientInvoiceStatus(
    admin,
    DAVORS,
    draftInvoice.id,
    "paid",
  );
  if (paidResult.error || !paidResult.invoice) {
    throw new Error(paidResult.error ?? "Mark as paid failed");
  }

  const paidIncome = await loadIncomeRow(admin, paidResult.invoice.invoice_number);
  console.log("Income after paid:", paidIncome);

  if (!paidIncome) {
    throw new Error("Expected income_register row after marking invoice as paid");
  }
  if (paidIncome.payment_status !== "Paid") {
    throw new Error(`Expected Paid, got ${paidIncome.payment_status}`);
  }
  if (Number(paidIncome.amount_received) !== Number(draftInvoice.total_amount_due)) {
    throw new Error(
      `amount_received mismatch: ${paidIncome.amount_received} vs ${draftInvoice.total_amount_due}`,
    );
  }
  if (Number(paidIncome.outstanding_balance) !== 0) {
    throw new Error(`Expected zero outstanding, got ${paidIncome.outstanding_balance}`);
  }

  console.log("\nPASS: draft → sent → paid synced income_register via invoice_no");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
