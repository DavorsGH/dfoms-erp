/**
 * Ensure every production tenant has a dedicated "Contract Document Sent" transactional
 * template and that contract_document_sent rules point at it (not Contract Raised).
 *
 * Usage:
 *   npx tsx scripts/apply-contract-document-sent-templates-production.ts --env-file .env.local.backup --dry-run
 *   npx tsx scripts/apply-contract-document-sent-templates-production.ts --env-file .env.local.backup
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildClientDocumentTemplateSpecs } from "../utils/client-document-notification-templates";
import { assert, loadEnvFromArgv } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DEDICATED_EVENT = "contract_document_sent" as const;
const CONTRACT_RAISED_NAME = "Contract Raised";

const dedicatedSpec = buildClientDocumentTemplateSpecs().find(
  (spec) => spec.event_type === DEDICATED_EVENT,
);
assert(dedicatedSpec, "Missing contract_document_sent spec in buildClientDocumentTemplateSpecs");

type TenantRow = { id: string; name: string | null };

type RuleRow = {
  id: string;
  template_id: string;
  is_active: boolean;
  message_templates: { name: string } | { name: string }[] | null;
};

export type TenantContractDocumentSentAudit = {
  tenant_id: string;
  tenant_name: string;
  category: "no_rule" | "wrong_template" | "correct" | "no_rule_will_create";
  dedicated_template_exists: boolean;
  rule_template_name: string | null;
  rule_is_active: boolean | null;
  planned_actions: string[];
};

function templateNameFromJoin(
  join: RuleRow["message_templates"],
): string | null {
  if (!join) return null;
  if (Array.isArray(join)) return join[0]?.name ?? null;
  return join.name ?? null;
}

async function loadProductionTenants(admin: SupabaseClient): Promise<TenantRow[]> {
  const { data, error } = await admin
    .from("tenants")
    .select("id, name")
    .order("name");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as TenantRow[];
}

async function findDedicatedTemplate(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin
    .from("message_templates")
    .select("id, name, is_active")
    .eq("tenant_id", tenantId)
    .eq("template_type", "transactional")
    .eq("name", dedicatedSpec!.name)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as { id: string; name: string; is_active: boolean } | null;
}

async function loadContractDocumentSentRule(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin
    .from("transactional_notification_rules")
    .select("id, template_id, is_active, message_templates(name)")
    .eq("tenant_id", tenantId)
    .eq("event_type", DEDICATED_EVENT)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as RuleRow | null;
}

export function auditTenantContractDocumentSent(options: {
  tenant: TenantRow;
  dedicatedTemplate: { id: string; name: string } | null;
  rule: RuleRow | null;
}): TenantContractDocumentSentAudit {
  const dedicatedExists = Boolean(options.dedicatedTemplate);
  const ruleTemplateName = options.rule
    ? templateNameFromJoin(options.rule.message_templates)
    : null;
  const planned_actions: string[] = [];

  if (!dedicatedExists) {
    planned_actions.push(`create template "${dedicatedSpec!.name}" (channel both)`);
  }

  if (!options.rule) {
    planned_actions.push(
      `create rule ${DEDICATED_EVENT} -> "${dedicatedSpec!.name}" (enabled)`,
    );
    return {
      tenant_id: options.tenant.id,
      tenant_name: options.tenant.name?.trim() || options.tenant.id,
      category: dedicatedExists ? "no_rule" : "no_rule_will_create",
      dedicated_template_exists: dedicatedExists,
      rule_template_name: null,
      rule_is_active: null,
      planned_actions,
    };
  }

  const isCorrect =
    dedicatedExists &&
    options.rule.template_id === options.dedicatedTemplate!.id &&
    ruleTemplateName === dedicatedSpec!.name;

  if (isCorrect) {
    return {
      tenant_id: options.tenant.id,
      tenant_name: options.tenant.name?.trim() || options.tenant.id,
      category: "correct",
      dedicated_template_exists: true,
      rule_template_name: ruleTemplateName,
      rule_is_active: options.rule.is_active,
      planned_actions,
    };
  }

  if (ruleTemplateName === CONTRACT_RAISED_NAME || ruleTemplateName !== dedicatedSpec!.name) {
    planned_actions.push(
      `repoint rule ${DEDICATED_EVENT} from "${ruleTemplateName ?? "unknown"}" -> "${dedicatedSpec!.name}"`,
    );
  }

  if (!dedicatedExists) {
    // repoint/create covered above
  }

  return {
    tenant_id: options.tenant.id,
    tenant_name: options.tenant.name?.trim() || options.tenant.id,
    category: "wrong_template",
    dedicated_template_exists: dedicatedExists,
    rule_template_name: ruleTemplateName,
    rule_is_active: options.rule.is_active,
    planned_actions,
  };
}

async function ensureDedicatedTemplate(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const existing = await findDedicatedTemplate(admin, tenantId);
  if (existing?.id) {
    const { error: updateError } = await admin
      .from("message_templates")
      .update({
        subject: dedicatedSpec!.subject,
        body_email: dedicatedSpec!.body_email,
        body_sms: dedicatedSpec!.body_sms,
        variables: dedicatedSpec!.variables,
        channel: "both",
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("tenant_id", tenantId);

    if (updateError) {
      throw new Error(updateError.message);
    }
    return existing.id;
  }

  const { data: created, error: insertError } = await admin
    .from("message_templates")
    .insert({
      tenant_id: tenantId,
      name: dedicatedSpec!.name,
      template_type: "transactional",
      channel: "both",
      subject: dedicatedSpec!.subject,
      body_email: dedicatedSpec!.body_email,
      body_sms: dedicatedSpec!.body_sms,
      variables: dedicatedSpec!.variables,
      is_active: true,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message ?? "Template insert failed");
  }

  return created.id as string;
}

async function upsertDedicatedRule(
  admin: SupabaseClient,
  tenantId: string,
  templateId: string,
  existingRule: RuleRow | null,
) {
  const isActive = existingRule?.is_active ?? true;

  const { error } = await admin.from("transactional_notification_rules").upsert(
    {
      tenant_id: tenantId,
      event_type: DEDICATED_EVENT,
      template_id: templateId,
      channel: "both",
      is_active: isActive,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id,event_type" },
  );

  if (error) {
    throw new Error(error.message);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const envFile = loadEnvFromArgv(process.argv);
  console.log(`Using env file: ${envFile}`);
  console.log(`Mode: ${dryRun ? "DRY RUN (no writes)" : "COMMIT"}`);
  console.log(`Dedicated template name: "${dedicatedSpec!.name}" (channel both)\n`);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(supabaseUrl.includes(PRODUCTION_REF), "Refusing non-production Supabase URL");
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tenants = await loadProductionTenants(admin);
  console.log(`Production tenants: ${tenants.length}\n`);

  const audits: TenantContractDocumentSentAudit[] = [];

  for (const tenant of tenants) {
    const [dedicatedTemplate, rule] = await Promise.all([
      findDedicatedTemplate(admin, tenant.id),
      loadContractDocumentSentRule(admin, tenant.id),
    ]);
    audits.push(
      auditTenantContractDocumentSent({
        tenant,
        dedicatedTemplate,
        rule,
      }),
    );
  }

  const counts = {
    correct: audits.filter((row) => row.category === "correct").length,
    wrong_template: audits.filter((row) => row.category === "wrong_template").length,
    no_rule: audits.filter((row) => row.category === "no_rule").length,
    no_rule_will_create: audits.filter((row) => row.category === "no_rule_will_create")
      .length,
  };

  console.log("=== Per-tenant audit ===");
  for (const row of audits) {
    console.log(
      [
        row.tenant_name,
        `(${row.tenant_id})`,
        `category=${row.category}`,
        `dedicated_template=${row.dedicated_template_exists ? "yes" : "no"}`,
        row.rule_template_name
          ? `rule->"${row.rule_template_name}" active=${row.rule_is_active}`
          : "rule=(none)",
      ].join(" | "),
    );
    if (row.planned_actions.length > 0) {
      for (const action of row.planned_actions) {
        console.log(`  - ${action}`);
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`correct dedicated template + rule: ${counts.correct}`);
  console.log(`wrong template (incl. Contract Raised): ${counts.wrong_template}`);
  console.log(
    `no rule (dedicated template already exists): ${counts.no_rule}`,
  );
  console.log(
    `no rule and no dedicated template: ${counts.no_rule_will_create}`,
  );
  console.log(
    `tenants needing changes: ${audits.filter((row) => row.planned_actions.length > 0).length}`,
  );

  if (dryRun) {
    console.log("\nDry run complete — no database writes.");
    return;
  }

  console.log("\n=== Applying changes ===");
  for (const tenant of tenants) {
    const audit = audits.find((row) => row.tenant_id === tenant.id);
    if (!audit || audit.planned_actions.length === 0) {
      console.log(`SKIP ${audit?.tenant_name ?? tenant.id}: already correct`);
      continue;
    }

    const existingRule = await loadContractDocumentSentRule(admin, tenant.id);
    const templateId = await ensureDedicatedTemplate(admin, tenant.id);
    await upsertDedicatedRule(admin, tenant.id, templateId, existingRule);
    console.log(`OK ${audit.tenant_name}: ${audit.planned_actions.join("; ")}`);
  }

  console.log("\nApply complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
