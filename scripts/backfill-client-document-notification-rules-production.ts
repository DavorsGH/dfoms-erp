/**
 * Backfill platform-wide client-document notification rules on production.
 *
 * Usage:
 *   npx tsx scripts/backfill-client-document-notification-rules-production.ts
 *   npx tsx scripts/backfill-client-document-notification-rules-production.ts --apply --include-davors-refresh
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildClientDocumentTemplateSpecs,
  resolveClientPortalBaseUrl,
} from "../utils/client-document-notification-templates.ts";
import { substituteTemplatePlaceholders } from "../utils/message-template-render.ts";
import { seedTenantClientDocumentNotifications } from "../utils/tenant-client-document-notifications-seed.ts";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_TENANT_ID = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
const PAYSTACK_LIVE_TEST_TENANT_ID = "2b7f91fb-c4a5-4292-9b25-43fe74733fa2";

const EXCLUDED_BACKFILL_TENANT_IDS = new Set([
  DAVORS_TENANT_ID,
  CAANTA_TENANT_ID,
  PAYSTACK_LIVE_TEST_TENANT_ID,
]);

function loadEnvForce(filePath: string) {
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

function previewRenderedSubject(tenantName: string) {
  const spec = buildClientDocumentTemplateSpecs()[0];
  return substituteTemplatePlaceholders(spec.subject, {
    tenant_name: tenantName,
    quotation_number: "DF-CQUO-0001",
    customer_name: "Example Customer",
    amount: "GHS 1,000.00",
    valid_until: "2026-09-01",
  });
}

async function main() {
  const apply = process.argv.includes("--apply");
  const includeDavorsRefresh = process.argv.includes("--include-davors-refresh");
  loadEnvForce(resolve(".env.local.backup"));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: tenants, error } = await admin
    .from("tenants")
    .select("id, name, status, product_line, tenant_code")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const backfillTargets = (tenants ?? []).filter(
    (tenant) => !EXCLUDED_BACKFILL_TENANT_IDS.has(tenant.id),
  );

  console.log("=== Client-document notification backfill (production) ===");
  console.log(`Portal base URL: ${resolveClientPortalBaseUrl()}`);
  console.log(`Mode: ${apply ? "APPLY" : "LIST ONLY"}`);
  console.log(
    `Excluded: Davors, Caanta Market, Paystack Live Test Co`,
  );
  console.log(`Tenants to backfill: ${backfillTargets.length}\n`);

  for (const tenant of backfillTargets) {
    console.log(`- ${tenant.name} (${tenant.id})`);
    console.log(`  sample subject: ${previewRenderedSubject(tenant.name)}`);
  }

  if (!apply) {
    console.log("\nNo changes made.");
    return;
  }

  console.log("\n=== Applying backfill ===");
  for (const tenant of backfillTargets) {
    const result = await seedTenantClientDocumentNotifications(admin, tenant.id);
    if (result.error) throw new Error(`${tenant.name}: ${result.error}`);
    console.log(
      `${tenant.name}: templatesCreated=${result.templatesCreated}, templatesUpdated=${result.templatesUpdated}, rulesUpserted=${result.rulesUpserted}`,
    );
    console.log(`  templateIds: ${result.templateIds.join(", ")}`);
  }

  if (includeDavorsRefresh) {
    const result = await seedTenantClientDocumentNotifications(
      admin,
      DAVORS_TENANT_ID,
      { forceRefreshTemplates: true },
    );
    if (result.error) throw new Error(`Davors refresh: ${result.error}`);
    console.log(
      `Davors Facilities: templatesCreated=${result.templatesCreated}, templatesUpdated=${result.templatesUpdated}, rulesUpserted=${result.rulesUpserted}`,
    );
    console.log(`  templateIds: ${result.templateIds.join(", ")}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
