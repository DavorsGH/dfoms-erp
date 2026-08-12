/**
 * Re-render client document PDFs after page-break fixes.
 * Usage: npx tsx scripts/_render-document-pdf-pagebreak-check.ts
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
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { renderClientQuotationPdfBuffer } = await import(
    "../utils/client-quotation-pdf-server.tsx"
  );
  const { renderClientInvoicePdfBuffer } = await import(
    "../utils/client-invoice-pdf-server.tsx"
  );
  const { renderClientReceiptPdfBuffer } = await import(
    "../utils/client-receipt-pdf-server.tsx"
  );
  const { resolveAuthorizedByDisplayTitle } = await import(
    "../app/dashboard/finance/client-invoices/client-invoice-display-utils"
  );
  const { getTenantBrandingById } = await import("../utils/tenant-branding");

  const { data: quotation } = await admin
    .from("client_quotations")
    .select("id, authorized_by_title")
    .eq("tenant_id", DAVORS)
    .eq("quotation_number", "DF-CQUO-0002")
    .maybeSingle();

  const { data: invoice } = await admin
    .from("client_invoices")
    .select("id, authorized_by_title")
    .eq("tenant_id", DAVORS)
    .eq("invoice_number", "DF-INV-0001")
    .maybeSingle();

  const { data: receipt } = await admin
    .from("client_receipts")
    .select("id, authorized_by_title")
    .eq("tenant_id", DAVORS)
    .eq("receipt_number", "DF-RCPT-0002")
    .maybeSingle();

  const branding = await getTenantBrandingById(DAVORS);

  const jobs = [
    {
      label: "quotation-DF-CQUO-0002",
      run: () =>
        renderClientQuotationPdfBuffer({
          supabase: admin,
          tenantId: DAVORS,
          quotationId: quotation.id,
        }),
    },
    {
      label: "invoice-DF-INV-0001",
      run: () =>
        renderClientInvoicePdfBuffer({
          supabase: admin,
          tenantId: DAVORS,
          invoiceId: invoice.id,
        }),
    },
    {
      label: "receipt-DF-RCPT-0002",
      run: () =>
        renderClientReceiptPdfBuffer({
          supabase: admin,
          tenantId: DAVORS,
          receiptId: receipt.id,
        }),
    },
  ];

  for (const job of jobs) {
    const rendered = await job.run();
    if (!rendered.ok) throw new Error(`${job.label}: ${rendered.error}`);
    const outPath = resolve(`scripts/_phase2-prod-${job.label}.pdf`);
    writeFileSync(outPath, rendered.buffer);
    const pageCount = (rendered.buffer.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [])
      .length;
    console.log(`${job.label}: ${outPath} (${rendered.buffer.length} bytes, ~${pageCount} pages)`);
  }

  console.log("\nAuthorized-by display titles (Workspace Settings wins):");
  console.log(
    "  workspace:",
    branding.signatureAuthorTitle?.trim() || "(none)",
  );
  console.log(
    "  quotation:",
    resolveAuthorizedByDisplayTitle(quotation?.authorized_by_title, branding),
  );
  console.log(
    "  invoice:",
    resolveAuthorizedByDisplayTitle(invoice?.authorized_by_title, branding),
  );
  console.log(
    "  receipt:",
    resolveAuthorizedByDisplayTitle(receipt?.authorized_by_title, branding),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
