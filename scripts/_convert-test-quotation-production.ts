/**
 * Check quotation conversion status and convert DF-CQUO-0002 when accepted.
 * Usage: npx tsx scripts/_convert-test-quotation-production.ts
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
const TARGET_NUMBERS = ["DF-CQUO-0001", "DF-CQUO-0002"];

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
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim(),
  )?.[1];
  if (ref !== PRODUCTION_REF) {
    throw new Error(`Expected production ref ${PRODUCTION_REF}, got ${ref ?? "(invalid)"}`);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { CLIENT_QUOTATION_LIST_SELECT } = await import(
    "../utils/client-quotations-types"
  );
  const { convertClientQuotationToInvoice } = await import(
    "../utils/client-quotations-api"
  );
  const { resolveConvertedInvoiceLink } = await import(
    "../utils/client-quotations-types"
  );

  console.log("Checking quotation conversion status...\n");

  const rows = [];
  for (const quotationNumber of TARGET_NUMBERS) {
    const { data, error } = await admin
      .from("client_quotations")
      .select(CLIENT_QUOTATION_LIST_SELECT)
      .eq("tenant_id", DAVORS)
      .eq("quotation_number", quotationNumber)
      .maybeSingle();

    if (error) {
      throw new Error(`${quotationNumber}: ${error.message}`);
    }

    if (!data) {
      console.log(`${quotationNumber}: not found`);
      continue;
    }

    const converted = resolveConvertedInvoiceLink(data);
    console.log(`${quotationNumber}:`);
    console.log(`  id: ${data.id}`);
    console.log(`  status: ${data.status}`);
    console.log(`  converted_invoice_id: ${data.converted_invoice_id ?? "(null)"}`);
    console.log(
      `  converted invoice embed: ${
        converted ? `${converted.invoice_number} (${converted.id})` : "(none)"
      }`,
    );
    rows.push(data);
  }

  const target =
    rows.find((row) => row.quotation_number === "DF-CQUO-0002") ??
    rows.find((row) => row.status === "accepted" && !row.converted_invoice_id);

  if (!target) {
    console.log("\nNo eligible quotation found to convert.");
    return;
  }

  if (target.converted_invoice_id) {
    console.log(
      `\n${target.quotation_number} already converted — badge should display in list.`,
    );
    return;
  }

  if (target.status !== "accepted") {
    console.log(
      `\n${target.quotation_number} status is "${target.status}" — must be accepted before convert.`,
    );
    return;
  }

  console.log(`\nConverting ${target.quotation_number} (${target.id})...`);
  const { invoice, error: convertError } = await convertClientQuotationToInvoice(
    admin,
    DAVORS,
    target.id,
  );

  if (convertError || !invoice) {
    throw new Error(convertError ?? "Convert failed");
  }

  console.log(`Created invoice ${invoice.invoice_number} (${invoice.id})`);

  const { data: refreshed, error: refreshError } = await admin
    .from("client_quotations")
    .select(CLIENT_QUOTATION_LIST_SELECT)
    .eq("id", target.id)
    .single();

  if (refreshError) {
    throw new Error(refreshError.message);
  }

  const converted = resolveConvertedInvoiceLink(refreshed);
  console.log("\nAfter convert:");
  console.log(`  converted_invoice_id: ${refreshed.converted_invoice_id}`);
  console.log(
    `  list badge would show: ${
      converted ? `Converted → ${converted.invoice_number}` : "(missing — debug join)"
    }`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
