/**
 * Read-only: check quotation conversion status on production.
 * Usage: npx tsx scripts/_probe-quotation-conversion-production.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

  const select =
    "id, quotation_number, status, converted_invoice_id, converted_invoice:client_invoices!client_quotations_converted_invoice_id_fkey(id, invoice_number)";

  for (const quotationNumber of TARGET_NUMBERS) {
    const { data, error } = await admin
      .from("client_quotations")
      .select(select)
      .eq("tenant_id", DAVORS)
      .eq("quotation_number", quotationNumber)
      .maybeSingle();

    if (error) throw new Error(`${quotationNumber}: ${error.message}`);
    if (!data) {
      console.log(`${quotationNumber}: not found`);
      continue;
    }

    const embed = Array.isArray(data.converted_invoice)
      ? data.converted_invoice[0]
      : data.converted_invoice;

    console.log(`${quotationNumber}:`);
    console.log(`  status: ${data.status}`);
    console.log(`  converted_invoice_id: ${data.converted_invoice_id ?? "(null)"}`);
    console.log(
      `  embed: ${embed ? `${embed.invoice_number} (${embed.id})` : "(none)"}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
