/**
 * Re-render production quotation PDFs for both document_type paths.
 * Usage: npx tsx scripts/_render-quotation-pdf-fix-check.ts
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  quotationNumberMetaLabel,
  quotationPrintTitle,
} from "../utils/client-quotations-types";

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

function extractPdfText(buffer) {
  return buffer.toString("utf8");
}

async function renderOne(admin, quotation, documentTypeOverride = quotation.document_type) {
  const { loadClientQuotationDetail } = await import("../utils/client-quotations-api");
  const { normalizeClientQuotationDetail } = await import(
    "../app/dashboard/sales-crm/quotations/client-quotation-display-utils"
  );
  const { loadTenantBillingSettingsHeader } = await import("../utils/billing-settings-load");
  const { getTenantBrandingById } = await import("../utils/tenant-branding");
  const { resolvePdfBrandingImages } = await import("../utils/pdf-branding-images");
  const { renderPdfBuffer } = await import("../utils/render-pdf-buffer");
  const React = await import("react");
  const ClientQuotationPdfDocument = (
    await import("../app/dashboard/sales-crm/quotations/client-quotation-pdf-document")
  ).default;
  const { PAYMENT_ACCOUNT_SELECT } = await import("../utils/payment-accounts-types");

  const detail = await loadClientQuotationDetail(admin, DAVORS, quotation.id);
  if (detail.error || !detail.quotation) {
    throw new Error(detail.error ?? "Quotation not found.");
  }

  let paymentAccounts = [];
  if (detail.payment_account_ids.length > 0) {
    const { data } = await admin
      .from("payment_accounts")
      .select(PAYMENT_ACCOUNT_SELECT)
      .eq("tenant_id", DAVORS)
      .in("id", detail.payment_account_ids);
    paymentAccounts = data ?? [];
  }

  const [branding, billingSettings] = await Promise.all([
    getTenantBrandingById(DAVORS),
    loadTenantBillingSettingsHeader(admin, DAVORS),
  ]);

  const display = normalizeClientQuotationDetail({
    client_quotation: {
      ...detail.quotation,
      document_type: documentTypeOverride,
    },
    line_items: detail.line_items,
    payment_account_ids: detail.payment_account_ids,
    payment_accounts: paymentAccounts,
  });
  display.branding = branding;
  display.billingSettings = billingSettings;

  const { logoUrl } = await resolvePdfBrandingImages({
    supabase: admin,
    tenantId: DAVORS,
    branding,
  });

  const buffer = await renderPdfBuffer(
    React.createElement(ClientQuotationPdfDocument, { ...display, logoUrl }),
  );

  const suffix =
    documentTypeOverride === quotation.document_type
      ? quotation.quotation_number
      : `${quotation.quotation_number}-${documentTypeOverride}`;
  const outPath = resolve(`scripts/_phase2-prod-quotation-${suffix}.pdf`);
  writeFileSync(outPath, buffer);

  const expectedTitle = quotationPrintTitle(documentTypeOverride);
  const expectedLabel = quotationNumberMetaLabel(documentTypeOverride).trim();
  const pdfText = extractPdfText(buffer);

  console.log(`\n${quotation.quotation_number} (${documentTypeOverride})`);
  console.log("  expected badge:", expectedTitle);
  console.log("  expected meta label:", expectedLabel);
  console.log("  saved:", outPath, `(${buffer.length} bytes)`);
  console.log("  badge present:", pdfText.includes(expectedTitle));
  console.log("  meta label present:", pdfText.includes(expectedLabel));
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

  const { data: proformaRecord, error: proformaError } = await admin
    .from("client_quotations")
    .select("id, quotation_number, document_type")
    .eq("tenant_id", DAVORS)
    .eq("document_type", "proforma_invoice")
    .order("quotation_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (proformaError || !proformaRecord) {
    throw new Error(proformaError?.message ?? "No proforma_invoice record found.");
  }

  const { data: quotationRecord } = await admin
    .from("client_quotations")
    .select("id, quotation_number, document_type")
    .eq("document_type", "quotation")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log("Rendering document_type paths...");
  await renderOne(admin, proformaRecord, "proforma_invoice");

  if (quotationRecord) {
    await renderOne(admin, quotationRecord, quotationRecord.document_type);
  } else {
    console.log(
      "\nNo production quotation record found; rendering quotation path from proforma detail with document_type override.",
    );
    await renderOne(admin, proformaRecord, "quotation");
  }
  console.log("\nDone.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
