/**
 * One-off: render live production SMS examples for reporting.
 * Usage: npx tsx scripts/_probe-rendered-sms-production.ts --env-file .env.local.backup
 */
import { createClient } from "@supabase/supabase-js";
import { substituteTemplatePlaceholders } from "../utils/message-template-render";
import { assert, loadEnvFromArgv } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

const TENANTS = [
  { label: "Davors", id: "00000001-0000-4000-8000-000000000001" },
  { label: "Nextronics", id: "da8b968e-dd42-48d5-93c5-a3147ff5de72" },
  { label: "Caanta", id: "12df4ee6-3fd1-459f-8d5c-792b5d5b3821" },
];

async function main() {
  loadEnvFromArgv(process.argv);
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(supabaseUrl.includes(PRODUCTION_REF), "Refusing non-production Supabase URL");
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const t of TENANTS) {
    const [{ data: tenant }, { data: templates }, { data: customer }] = await Promise.all([
      admin.from("tenants").select("name").eq("id", t.id).maybeSingle(),
      admin
        .from("message_templates")
        .select("name, body_sms")
        .eq("tenant_id", t.id)
        .eq("template_type", "transactional")
        .in("name", ["Quotation Sent", "Invoice Created", "Receipt Issued"])
        .order("name"),
      admin
        .from("customers")
        .select("client_name")
        .eq("tenant_id", t.id)
        .not("client_name", "is", null)
        .order("client_name")
        .limit(1)
        .maybeSingle(),
    ]);

    const tenantName = tenant?.name?.trim() || t.label;
    const customerName = customer?.client_name?.trim() || "Sample Customer Ltd";

    const vars = {
      tenant_name: tenantName,
      customer_name: customerName,
      quotation_number: "Q-004",
      invoice_number: "INV-2026-0042",
      receipt_number: "RCP-2026-0018",
      amount: "GHS 12,500.00",
      valid_until: "30 Sep 2026",
      due_date: "15 Sep 2026",
    };

    console.log(`\n=== ${t.label} (${t.id}) ===`);
    console.log(`Tenant company: ${tenantName}`);
    console.log(`Sample customer company: ${customerName}`);

    for (const row of templates ?? []) {
      const rendered = substituteTemplatePlaceholders(row.body_sms ?? "", vars);
      console.log(`\n[${row.name}]`);
      console.log(rendered);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
