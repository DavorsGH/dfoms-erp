/**
 * One-off: seed Caanta Market client-document notification rules (production).
 * Usage: npx tsx scripts/_env-ref-check.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { seedTenantClientDocumentNotifications } from "../utils/tenant-client-document-notifications-seed.ts";

const CAANTA = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";

for (const line of readFileSync(resolve(".env.local.backup"), "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i < 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
    v = v.slice(1, -1);
  process.env[t.slice(0, i).trim()] = v;
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const result = await seedTenantClientDocumentNotifications(admin, CAANTA);
  if (result.error) throw new Error(result.error);
  console.log("SEED", JSON.stringify(result, null, 2));

  const { data: rules, error } = await admin
    .from("transactional_notification_rules")
    .select(
      "event_type, channel, is_active, template_id, message_templates(name, subject, channel, is_active, template_type)",
    )
    .eq("tenant_id", CAANTA)
    .in("event_type", ["quotation_sent", "invoice_created", "receipt_issued"])
    .order("event_type");
  if (error) throw new Error(error.message);
  console.log("RULES", JSON.stringify(rules, null, 2));

  const { data: nextronics } = await admin
    .from("transactional_notification_rules")
    .select("event_type, channel, is_active, message_templates(subject)")
    .eq("tenant_id", "da8b968e-dd42-48d5-93c5-a3147ff5de72")
    .in("event_type", ["quotation_sent", "invoice_created", "receipt_issued"])
    .order("event_type");
  console.log("NEXTRONICS_REFERENCE", JSON.stringify(nextronics, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
