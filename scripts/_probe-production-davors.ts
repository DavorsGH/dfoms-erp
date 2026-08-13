// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
  const DAVORS = "00000001-0000-4000-8000-000000000001";

  const { data: tenant } = await admin
    .from("tenants")
    .select("name, signature_url, logo_url, signature_author_name")
    .eq("id", DAVORS)
    .maybeSingle();
  console.log("Davors tenant:", tenant);

  const { data: inv } = await admin
    .from("client_invoices")
    .select("id, invoice_number, client_id, status, total_amount_due, amount_received, bill_to_name")
    .eq("tenant_id", DAVORS)
    .order("invoice_date", { ascending: false });
  console.log("invoices:", inv);

  for (const row of inv ?? []) {
    const { data: cust } = await admin
      .from("customers")
      .select("client_name, email")
      .eq("tenant_id", DAVORS)
      .eq("client_id", row.client_id)
      .maybeSingle();
    console.log(`customer for ${row.invoice_number}:`, cust);
  }

  const { data: quo } = await admin
    .from("client_quotations")
    .select("id, quotation_number, status, client_id, total_amount_due, valid_until, bill_to_name")
    .eq("tenant_id", DAVORS);
  console.log("quotations:", quo);
}

main().catch(console.error);
