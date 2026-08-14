import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildClientDocumentTemplateSpecs,
  CLIENT_DOCUMENT_NOTIFICATION_EVENTS,
  type ClientDocumentNotificationEvent,
} from "@/utils/client-document-notification-templates";

export type SeedClientDocumentNotificationsResult = {
  skipped: boolean;
  templatesCreated: number;
  templatesUpdated: number;
  rulesUpserted: number;
  templateIds: string[];
  error: string | null;
};

async function findTemplateByName(
  admin: SupabaseClient,
  tenantId: string,
  name: string,
) {
  const { data, error } = await admin
    .from("message_templates")
    .select("id, name, is_active")
    .eq("tenant_id", tenantId)
    .eq("name", name)
    .eq("template_type", "transactional")
    .maybeSingle();

  if (error) {
    return { template: null, error: error.message };
  }

  return { template: data, error: null };
}

/**
 * Seed (or refresh) the three client-document transactional templates and
 * active notification rules for a tenant. Idempotent: re-runs update template
 * copy and upsert rules when specs change.
 */
export async function seedTenantClientDocumentNotifications(
  admin: SupabaseClient,
  tenantId: string,
): Promise<SeedClientDocumentNotificationsResult> {
  const specs = buildClientDocumentTemplateSpecs();
  const templateIds: string[] = [];
  let templatesCreated = 0;
  let templatesUpdated = 0;
  let rulesUpserted = 0;

  for (const spec of specs) {
    const existing = await findTemplateByName(admin, tenantId, spec.name);
    if (existing.error) {
      return {
        skipped: false,
        templatesCreated,
        templatesUpdated,
        rulesUpserted,
        templateIds,
        error: existing.error,
      };
    }

    let templateId = existing.template?.id ?? null;

    if (templateId) {
      const { error: updateError } = await admin
        .from("message_templates")
        .update({
          subject: spec.subject,
          body_email: spec.body_email,
          body_sms: spec.body_sms,
          variables: spec.variables,
          channel: "both",
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", templateId)
        .eq("tenant_id", tenantId);

      if (updateError) {
        return {
          skipped: false,
          templatesCreated,
          templatesUpdated,
          rulesUpserted,
          templateIds,
          error: `Template update failed (${spec.event_type}): ${updateError.message}`,
        };
      }
      templatesUpdated += 1;
    } else {
      const { data: created, error: insertError } = await admin
        .from("message_templates")
        .insert({
          tenant_id: tenantId,
          name: spec.name,
          template_type: "transactional",
          channel: "both",
          subject: spec.subject,
          body_email: spec.body_email,
          body_sms: spec.body_sms,
          variables: spec.variables,
          is_active: true,
        })
        .select("id")
        .single();

      if (insertError || !created) {
        return {
          skipped: false,
          templatesCreated,
          templatesUpdated,
          rulesUpserted,
          templateIds,
          error:
            insertError?.message ??
            `Template insert failed (${spec.event_type}).`,
        };
      }
      templateId = created.id;
      templatesCreated += 1;
    }

    if (!templateId) {
      return {
        skipped: false,
        templatesCreated,
        templatesUpdated,
        rulesUpserted,
        templateIds,
        error: `Missing template id for ${spec.event_type}.`,
      };
    }

    templateIds.push(templateId);

    const { error: ruleError } = await admin
      .from("transactional_notification_rules")
      .upsert(
        {
          tenant_id: tenantId,
          event_type: spec.event_type,
          template_id: templateId,
          channel: "both",
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,event_type" },
      );

    if (ruleError) {
      return {
        skipped: false,
        templatesCreated,
        templatesUpdated,
        rulesUpserted,
        templateIds,
        error: `Rule upsert failed (${spec.event_type}): ${ruleError.message}`,
      };
    }
    rulesUpserted += 1;
  }

  return {
    skipped: false,
    templatesCreated,
    templatesUpdated,
    rulesUpserted,
    templateIds,
    error: null,
  };
}

/** Remove seeded client-document templates/rules (signup rollback helper). */
export async function rollbackTenantClientDocumentNotifications(
  admin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  await admin
    .from("transactional_notification_rules")
    .delete()
    .eq("tenant_id", tenantId)
    .in("event_type", [...CLIENT_DOCUMENT_NOTIFICATION_EVENTS]);

  const names = buildClientDocumentTemplateSpecs().map((spec) => spec.name);
  await admin
    .from("message_templates")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("template_type", "transactional")
    .in("name", names);
}

export function isClientDocumentNotificationEvent(
  value: string,
): value is ClientDocumentNotificationEvent {
  return (CLIENT_DOCUMENT_NOTIFICATION_EVENTS as readonly string[]).includes(
    value,
  );
}
