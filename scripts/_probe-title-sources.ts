// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

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

  const { data: tenant } = await admin
    .from("tenants")
    .select("signature_author_title, signature_author_name")
    .eq("id", DAVORS)
    .single();

  const { data: quotation } = await admin
    .from("client_quotations")
    .select("authorized_by_title, authorized_by_name")
    .eq("quotation_number", "DF-CQUO-0002")
    .single();

  const { data: invoice } = await admin
    .from("client_invoices")
    .select("authorized_by_title, authorized_by_name")
    .eq("invoice_number", "DF-INV-0001")
    .single();

  const { data: receipt } = await admin
    .from("client_receipts")
    .select("authorized_by_title, authorized_by_name")
    .eq("receipt_number", "DF-RCPT-0002")
    .single();

  console.log("Workspace:", tenant);
  console.log("Quotation stored:", quotation);
  console.log("Invoice stored:", invoice);
  console.log("Receipt stored:", receipt);

  function displayTitle(docTitle, workspaceTitle) {
    return workspaceTitle?.trim() || docTitle?.trim() || "";
  }

  console.log("\nResolved display titles (after fix):");
  console.log("  quotation:", displayTitle(quotation?.authorized_by_title, tenant?.signature_author_title));
  console.log("  invoice:", displayTitle(invoice?.authorized_by_title, tenant?.signature_author_title));
  console.log("  receipt:", displayTitle(receipt?.authorized_by_title, tenant?.signature_author_title));
}

main();
