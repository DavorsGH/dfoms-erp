import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import CrmShell from "../../crm-shell";
import EmailPromotionsShell from "../email-promotions-shell";
import NotificationRules from "./notification-rules";
import {
  MESSAGE_TEMPLATE_SELECT,
  normalizeMessageTemplateRow,
  type MessageTemplateRow,
} from "@/utils/message-templates-types";
import {
  mergeRulesWithDefaults,
} from "@/utils/transactional-notification-types";

export default async function NotificationRulesPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!tenantId) {
    return (
      <CrmShell sectionTitle="Email & Promotions">
        <EmailPromotionsShell sectionTitle="Notification Rules">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Unable to resolve tenant for notification rules.
          </p>
        </EmailPromotionsShell>
      </CrmShell>
    );
  }

  const [rulesResult, templatesResult] = await Promise.all([
    supabase
      .from("transactional_notification_rules")
      .select(
        "id, tenant_id, event_type, template_id, channel, is_active, message_templates(name)",
      )
      .eq("tenant_id", tenantId),
    supabase
      .from("message_templates")
      .select(MESSAGE_TEMPLATE_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .eq("template_type", "transactional")
      .order("name", { ascending: true }),
  ]);

  const rules = mergeRulesWithDefaults(
    tenantId,
    (rulesResult.data as Parameters<typeof mergeRulesWithDefaults>[1]) ?? [],
  );
  const templates = (
    (templatesResult.data as MessageTemplateRow[] | null) ?? []
  ).map(normalizeMessageTemplateRow);

  const fetchError =
    rulesResult.error?.message ?? templatesResult.error?.message ?? null;

  return (
    <CrmShell sectionTitle="Email & Promotions">
      <EmailPromotionsShell sectionTitle="Notification Rules">
        <NotificationRules
          tenantId={tenantId}
          initialRules={rules}
          transactionalTemplates={templates}
          fetchError={fetchError}
        />
      </EmailPromotionsShell>
    </CrmShell>
  );
}
