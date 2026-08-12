/**
 * Phase 2 production tests: invoice_created, quotation_sent, receipt_issued.
 *
 * Defaults to production credentials (.env.local.backup -> tvcurcnmasnocwdxzgvz).
 *
 *   npx tsx scripts/test-phase2-client-document-email-production.ts --to david.avors@gmail.com
 *   npx tsx scripts/test-phase2-client-document-email-production.ts --event all --to david.avors@gmail.com
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const DAVORS = "00000001-0000-4000-8000-000000000001";
const DEFAULT_TO = "david.avors@gmail.com";
const PRODUCTION_ENV = ".env.local.backup";
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

function supabaseRef(url) {
  const m = /^https?:\/\/([^.]+)\.supabase\.co/.exec((url ?? "").trim());
  return m ? m[1] : "(invalid)";
}

function validateSupabaseEnv(envFile) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const looksPlaceholder =
    url.length < 20 ||
    !url.includes("supabase.co") ||
    /^[*x]+$/i.test(url.replace(/["']/g, ""));
  if (looksPlaceholder) {
    throw new Error(
      `${envFile} has an invalid or redacted NEXT_PUBLIC_SUPABASE_URL.`,
    );
  }
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

async function ensureRule(admin, tenantId, eventType, templateName, subject, bodyEmail, bodySms, variables) {
  const { data: existingTemplate } = await admin
    .from("message_templates")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("name", templateName)
    .maybeSingle();

  let templateId = existingTemplate?.id ?? null;
  if (!templateId) {
    const { data: created, error } = await admin
      .from("message_templates")
      .insert({
        tenant_id: tenantId,
        name: templateName,
        template_type: "transactional",
        channel: "email",
        subject,
        body_email: bodyEmail,
        body_sms: bodySms,
        variables,
        is_active: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Template create failed (${eventType}): ${error.message}`);
    templateId = created.id;
  }

  const { error: ruleError } = await admin
    .from("transactional_notification_rules")
    .upsert(
      {
        tenant_id: tenantId,
        event_type: eventType,
        template_id: templateId,
        channel: "email",
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,event_type" },
    );
  if (ruleError) {
    throw new Error(`Rule upsert failed (${eventType}): ${ruleError.message}`);
  }
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
  const { error: updateError } = await admin
    .from("customers")
    .update({ email: to })
    .eq("tenant_id", DAVORS)
    .eq("client_id", clientId);
  if (updateError) throw new Error(updateError.message);

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

async function savePdfCopy(label, buffer) {
  const outPath = resolve(`scripts/_phase2-prod-${label}.pdf`);
  writeFileSync(outPath, buffer);
  console.log(`  local PDF: ${outPath} (${buffer.length} bytes)`);
}

async function testInvoiceCreated(admin, to, invoiceId) {
  const { data: invoice, error } = await admin
    .from("client_invoices")
    .select("id, client_id, invoice_number, bill_to_name, total_amount_due, due_date, status")
    .eq("tenant_id", DAVORS)
    .eq("id", invoiceId)
    .maybeSingle();
  if (error || !invoice) throw new Error(error?.message ?? "Invoice not found.");

  await ensureRule(
    admin,
    DAVORS,
    "invoice_created",
    "Phase 2 Prod Test Invoice Created",
    "[Phase 2 prod test] Invoice {{invoice_number}}",
    "Dear {{customer_name}},\n\nAttached: invoice {{invoice_number}}.\nAmount: {{amount}}\nDue: {{due_date}}\n",
    "Invoice {{invoice_number}} issued.",
    ["customer_name", "invoice_number", "amount", "due_date"],
  );

  const { renderClientInvoicePdfBuffer } = await import("../utils/client-invoice-pdf-server.tsx");
  const rendered = await renderClientInvoicePdfBuffer({
    supabase: admin,
    tenantId: DAVORS,
    invoiceId: invoice.id,
  });
  if (!rendered.ok) throw new Error(rendered.error);
  await savePdfCopy(`invoice-${rendered.invoiceNumber}`, rendered.buffer);

  const { notifyClientInvoiceCreated } = await import("../utils/client-document-notifications.ts");
  await withCustomerEmail(admin, invoice.client_id, to, async () => {
    await notifyClientInvoiceCreated({
      tenantId: DAVORS,
      clientId: invoice.client_id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      customerName: invoice.bill_to_name?.trim() || invoice.client_id,
      amount: String(invoice.total_amount_due ?? ""),
      dueDate: invoice.due_date ?? "",
    });
  });

  console.log(`invoice_created sent for ${invoice.invoice_number} -> ${to}`);
}

async function testQuotationSent(admin, to, quotationId) {
  const { data: quotation, error } = await admin
    .from("client_quotations")
    .select("id, client_id, quotation_number, bill_to_name, total_amount_due, valid_until, status")
    .eq("tenant_id", DAVORS)
    .eq("id", quotationId)
    .maybeSingle();
  if (error || !quotation) throw new Error(error?.message ?? "Quotation not found.");

  await ensureRule(
    admin,
    DAVORS,
    "quotation_sent",
    "Phase 2 Prod Test Quotation Sent",
    "[Phase 2 prod test] Quotation {{quotation_number}}",
    "Dear {{customer_name}},\n\nAttached: quotation {{quotation_number}}.\nAmount: {{amount}}\nValid until: {{valid_until}}\n",
    "Quotation {{quotation_number}} sent.",
    ["customer_name", "quotation_number", "amount", "valid_until"],
  );

  const { renderClientQuotationPdfBuffer } = await import("../utils/client-quotation-pdf-server.tsx");
  const rendered = await renderClientQuotationPdfBuffer({
    supabase: admin,
    tenantId: DAVORS,
    quotationId: quotation.id,
  });
  if (!rendered.ok) throw new Error(rendered.error);
  await savePdfCopy(`quotation-${rendered.quotationNumber}`, rendered.buffer);

  const { notifyClientQuotationSent } = await import("../utils/client-document-notifications.ts");
  await withCustomerEmail(admin, quotation.client_id, to, async () => {
    await notifyClientQuotationSent({
      tenantId: DAVORS,
      clientId: quotation.client_id,
      quotationId: quotation.id,
      quotationNumber: quotation.quotation_number,
      customerName: quotation.bill_to_name?.trim() || quotation.client_id,
      amount: String(quotation.total_amount_due ?? ""),
      validUntil: quotation.valid_until ?? "",
    });
  });

  console.log(`quotation_sent sent for ${quotation.quotation_number} (status=${quotation.status}) -> ${to}`);
}

async function testReceiptIssued(admin, to, invoiceId) {
  const { recordClientInvoicePayment } = await import("../utils/client-invoice-payments-api.ts");

  const { data: invoice, error: invoiceError } = await admin
    .from("client_invoices")
    .select("id, client_id, invoice_number, bill_to_name, total_amount_due, amount_received, status")
    .eq("tenant_id", DAVORS)
    .eq("id", invoiceId)
    .maybeSingle();
  if (invoiceError || !invoice) throw new Error(invoiceError?.message ?? "Invoice not found.");

  const outstanding =
    Number(invoice.total_amount_due ?? 0) - Number(invoice.amount_received ?? 0);
  if (outstanding <= 0) {
    throw new Error(`Invoice ${invoice.invoice_number} has no outstanding balance for a test payment.`);
  }

  const paymentAmount = Math.min(1, outstanding);

  const result = await recordClientInvoicePayment(
    admin,
    DAVORS,
    invoice.id,
    {
      amount: paymentAmount,
      payment_date: new Date().toISOString().slice(0, 10),
      payment_method: "Bank Transfer",
      notes: "Phase 2 production test payment (automated)",
    },
    null,
  );

  if (result.error && !result.receipt) {
    throw new Error(result.error);
  }
  if (!result.receipt) {
    throw new Error("Payment did not produce a receipt.");
  }

  await ensureRule(
    admin,
    DAVORS,
    "receipt_issued",
    "Phase 2 Prod Test Receipt Issued",
    "[Phase 2 prod test] Receipt {{receipt_number}} for {{invoice_number}}",
    "Dear {{customer_name}},\n\nAttached: receipt {{receipt_number}} for invoice {{invoice_number}}.\nAmount: {{amount}}\nDate: {{payment_date}}\n",
    "Receipt {{receipt_number}} issued for invoice {{invoice_number}}.",
    ["customer_name", "receipt_number", "invoice_number", "amount", "payment_date"],
  );

  const { renderClientReceiptPdfBuffer } = await import("../utils/client-receipt-pdf-server.tsx");
  const rendered = await renderClientReceiptPdfBuffer({
    supabase: admin,
    tenantId: DAVORS,
    receiptId: result.receipt.id,
  });
  if (!rendered.ok) throw new Error(rendered.error);
  await savePdfCopy(`receipt-${rendered.receiptNumber}`, rendered.buffer);

  const { notifyClientReceiptIssued } = await import("../utils/client-document-notifications.ts");
  await withCustomerEmail(admin, invoice.client_id, to, async () => {
    await notifyClientReceiptIssued({
      tenantId: DAVORS,
      clientId: invoice.client_id,
      receiptId: result.receipt.id,
      receiptNumber: result.receipt.receipt_number,
      invoiceNumber: invoice.invoice_number,
      customerName: invoice.bill_to_name?.trim() || invoice.client_id,
      amount: String(result.receipt.amount ?? paymentAmount),
      paymentDate: result.receipt.receipt_date ?? "",
    });
  });

  console.log(
    `receipt_issued sent for ${result.receipt.receipt_number} on ${invoice.invoice_number} (payment GHS ${paymentAmount}) -> ${to}`,
  );
}

async function main() {
  const envFile = argValue("--env-file") ?? PRODUCTION_ENV;
  const event = (argValue("--event") ?? "all").trim().toLowerCase();
  const to = (argValue("--to") ?? DEFAULT_TO).trim();

  loadEnvForce(resolve(envFile));
  validateSupabaseEnv(envFile);

  const ref = supabaseRef(process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log(`Env file: ${envFile}`);
  console.log(`Supabase project ref: ${ref}`);
  if (ref !== PRODUCTION_REF) {
    throw new Error(
      `Refusing to run production tests against ${ref}. Expected ${PRODUCTION_REF}. Pass --env-file explicitly if intentional.`,
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: tenant } = await admin
    .from("tenants")
    .select("signature_url, logo_url")
    .eq("id", DAVORS)
    .maybeSingle();
  console.log("Davors signature_url configured:", Boolean(tenant?.signature_url?.trim()));
  console.log("Davors logo_url configured:", Boolean(tenant?.logo_url?.trim()));

  const invoiceId =
    argValue("--invoice-id")?.trim() ??
    (
      await admin
        .from("client_invoices")
        .select("id")
        .eq("tenant_id", DAVORS)
        .neq("status", "draft")
        .order("invoice_date", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data?.id;
  const quotationId =
    argValue("--quotation-id")?.trim() ??
    (
      await admin
        .from("client_quotations")
        .select("id")
        .eq("tenant_id", DAVORS)
        .order("issue_date", { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data?.id;
  const receiptInvoiceId = argValue("--receipt-invoice-id")?.trim() ?? invoiceId;

  if (!invoiceId) throw new Error("No production invoice found for test.");
  if (!quotationId) throw new Error("No production quotation found for test.");

  if (event === "all" || event === "invoice_created") {
    console.log("\n--- invoice_created ---");
    await testInvoiceCreated(admin, to, invoiceId);
  }
  if (event === "all" || event === "quotation_sent") {
    console.log("\n--- quotation_sent ---");
    await testQuotationSent(admin, to, quotationId);
  }
  if (event === "all" || event === "receipt_issued") {
    console.log("\n--- receipt_issued ---");
    await testReceiptIssued(admin, to, receiptInvoiceId);
  }

  console.log("\nPhase 2 production tests completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
