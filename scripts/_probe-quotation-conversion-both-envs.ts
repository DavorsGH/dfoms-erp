/**
 * Read-only: check quotation conversion on staging vs production.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
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

async function probe(label, envFile) {
  loadEnvForce(resolve(envFile));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );
  const ref = /^https?:\/\/([^.]+)\.supabase\.co/.exec(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim(),
  )?.[1];

  console.log(`\n=== ${label} (${ref}) ===`);
  const select =
    "quotation_number, status, converted_invoice_id, converted_invoice:client_invoices!client_quotations_converted_invoice_id_fkey(id, invoice_number)";

  for (const quotationNumber of TARGET_NUMBERS) {
    const { data, error } = await admin
      .from("client_quotations")
      .select(select)
      .eq("tenant_id", DAVORS)
      .eq("quotation_number", quotationNumber)
      .maybeSingle();

    if (error) {
      console.log(`${quotationNumber}: error ${error.message}`);
      continue;
    }
    if (!data) {
      console.log(`${quotationNumber}: not found`);
      continue;
    }

    const embed = Array.isArray(data.converted_invoice)
      ? data.converted_invoice[0]
      : data.converted_invoice;

    console.log(
      `${quotationNumber}: status=${data.status} converted_invoice_id=${data.converted_invoice_id ?? "null"} embed=${embed?.invoice_number ?? "null"}`,
    );
  }
}

async function main() {
  await probe("staging", ".env.local");
  await probe("production", ".env.local.backup");
}

main();
