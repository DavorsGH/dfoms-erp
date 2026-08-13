/**
 * Convert accepted staging quotation DF-CQUO-0002 for Converted badge test.
 * Usage: npx tsx scripts/_convert-staging-quotation-0002.ts
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
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TARGET_NUMBER = "DF-CQUO-0002";

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
  loadEnvForce(resolve(".env.local"));
  const ref = /^https?:\/\/([^.]+)\.supabase\.co/.exec(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim(),
  )?.[1];
  if (ref !== STAGING_REF) {
    throw new Error(`Expected staging ref ${STAGING_REF}, got ${ref ?? "(invalid)"}`);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { CLIENT_QUOTATION_LIST_SELECT, resolveConvertedInvoiceLink } = await import(
    "../utils/client-quotations-types"
  );
  const { convertClientQuotationToInvoice } = await import(
    "../utils/client-quotations-api"
  );

  const { data: quotation, error } = await admin
    .from("client_quotations")
    .select(CLIENT_QUOTATION_LIST_SELECT)
    .eq("tenant_id", DAVORS)
    .eq("quotation_number", TARGET_NUMBER)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!quotation) throw new Error(`${TARGET_NUMBER} not found on staging`);

  console.log("Before:", {
    status: quotation.status,
    converted_invoice_id: quotation.converted_invoice_id,
    badge: resolveConvertedInvoiceLink(quotation),
  });

  if (quotation.converted_invoice_id) {
    console.log("Already converted — refresh Quotations list to see badge.");
    return;
  }

  if (quotation.status !== "accepted") {
    throw new Error(`Cannot convert: status is "${quotation.status}" (need accepted)`);
  }

  const { invoice, error: convertError } = await convertClientQuotationToInvoice(
    admin,
    DAVORS,
    quotation.id,
  );
  if (convertError || !invoice) {
    throw new Error(convertError ?? "Convert failed");
  }

  const { data: refreshed } = await admin
    .from("client_quotations")
    .select(CLIENT_QUOTATION_LIST_SELECT)
    .eq("id", quotation.id)
    .single();

  console.log("Created invoice:", invoice.invoice_number, invoice.id);
  console.log("After:", {
    converted_invoice_id: refreshed.converted_invoice_id,
    badge: resolveConvertedInvoiceLink(refreshed),
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
