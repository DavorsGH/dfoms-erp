/**
 * Refresh client-document transactional email (+ SMS) templates for all production
 * tenants that already have quotation_sent / invoice_created / receipt_issued rules.
 *
 * Applies the receipt_issued {{amount_section}} body (and any other spec updates
 * from buildClientDocumentTemplateSpecs) via the shared seed helper.
 *
 * Usage:
 *   npx tsx scripts/apply-client-document-email-templates-production.ts --env-file .env.local.backup
 *   npx tsx scripts/apply-client-document-email-templates-production.ts --env-file .env.local.backup --dry-run
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";
import { buildClientDocumentTemplateSpecs } from "../utils/client-document-notification-templates";
import { seedTenantClientDocumentNotifications } from "../utils/tenant-client-document-notifications-seed";
import { assert, loadEnvFromArgv } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const NEXTRONICS_TENANT_ID = "da8b968e-dd42-48d5-93c5-a3147ff5de72";
const CAANTA_PRODUCTION_TENANT_ID = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";

const TEMPLATE_NAMES = buildClientDocumentTemplateSpecs().map((spec) => spec.name);
const RECEIPT_SPEC = buildClientDocumentTemplateSpecs().find(
  (spec) => spec.event_type === "receipt_issued",
);

async function loadTemplateEmailBodies(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin
    .from("message_templates")
    .select("name, body_email, variables")
    .eq("tenant_id", tenantId)
    .eq("template_type", "transactional")
    .in("name", TEMPLATE_NAMES)
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as Array<{
    name: string;
    body_email: string | null;
    variables: unknown;
  }>;
  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      {
        body_email: row.body_email ?? "",
        variables: row.variables,
      },
    ]),
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const envFile = loadEnvFromArgv(process.argv);
  console.log(`Using env file: ${envFile}`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "COMMIT"}`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(supabaseUrl.includes(PRODUCTION_REF), "Refusing non-production Supabase URL");
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: ruleRows, error: ruleError } = await admin
    .from("transactional_notification_rules")
    .select("tenant_id")
    .in("event_type", ["quotation_sent", "invoice_created", "receipt_issued"]);

  if (ruleError) {
    throw new Error(ruleError.message);
  }

  const tenantIds = [
    ...new Set((ruleRows ?? []).map((row) => row.tenant_id).filter(Boolean)),
  ].sort();

  console.log(`Tenants with client-document rules: ${tenantIds.length}`);

  if (RECEIPT_SPEC) {
    console.log("\n=== Target Receipt Issued body_email (from specs) ===");
    console.log(RECEIPT_SPEC.body_email);
    console.log("\nvariables:", RECEIPT_SPEC.variables.join(", "));
  }

  const reportSamples = [
    { label: "Davors", tenantId: DAVORS_TENANT_ID },
    { label: "Nextronics", tenantId: NEXTRONICS_TENANT_ID },
    { label: "Caanta", tenantId: CAANTA_PRODUCTION_TENANT_ID },
  ].filter((sample) => tenantIds.includes(sample.tenantId));

  const before: Record<
    string,
    Record<string, { body_email: string; variables: unknown }>
  > = {};
  for (const sample of reportSamples) {
    before[sample.tenantId] = await loadTemplateEmailBodies(admin, sample.tenantId);
  }

  if (dryRun) {
    console.log("\nDry run complete — no templates updated.");
    for (const sample of reportSamples) {
      const current = before[sample.tenantId]?.["Receipt Issued"];
      console.log(`\n=== ${sample.label} current Receipt Issued ===`);
      console.log(current?.body_email ?? "(missing)");
    }
    return;
  }

  let templatesUpdated = 0;
  for (const tenantId of tenantIds) {
    const result = await seedTenantClientDocumentNotifications(admin, tenantId);
    if (result.error) {
      throw new Error(`${tenantId}: ${result.error}`);
    }
    templatesUpdated += result.templatesUpdated;
    console.log(
      `OK ${tenantId}: created=${result.templatesCreated} updated=${result.templatesUpdated} rules=${result.rulesUpserted}`,
    );
  }

  console.log(`\nTotal template rows updated: ${templatesUpdated}`);

  for (const sample of reportSamples) {
    const after = await loadTemplateEmailBodies(admin, sample.tenantId);
    console.log(`\n=== ${sample.label} (${sample.tenantId}) Receipt Issued ===`);
    console.log("--- BEFORE ---");
    console.log(before[sample.tenantId]?.["Receipt Issued"]?.body_email ?? "(missing)");
    console.log("--- AFTER ---");
    console.log(after["Receipt Issued"]?.body_email ?? "(missing)");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
