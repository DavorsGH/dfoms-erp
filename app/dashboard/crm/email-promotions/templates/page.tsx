import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import CrmShell from "../../crm-shell";
import EmailPromotionsShell from "../email-promotions-shell";
import SalesCrmMountErrorAlert from "@/lib/crm/sales-crm-mount-error-alert";
import MessageTemplates from "./message-templates";
import {
  MESSAGE_TEMPLATE_SELECT,
  normalizeMessageTemplateRow,
  type MessageTemplateRow,
} from "@/utils/message-templates-types";

export default async function MessageTemplatesPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!tenantId) {
    return (
      <CrmShell sectionTitle="Email & Promotions">
        <EmailPromotionsShell sectionTitle="Templates">
          <SalesCrmMountErrorAlert message="Unable to resolve tenant for message templates." />
          <p className="text-sm text-slate-600">
            Unable to load message templates for this workspace.
          </p>
        </EmailPromotionsShell>
      </CrmShell>
    );
  }

  const { data, error } = await supabase
    .from("message_templates")
    .select(MESSAGE_TEMPLATE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("updated_at", { ascending: false });

  const templates = ((data as MessageTemplateRow[] | null) ?? []).map(
    normalizeMessageTemplateRow,
  );

  return (
    <CrmShell sectionTitle="Email & Promotions">
      <EmailPromotionsShell sectionTitle="Templates">
        <MessageTemplates
          tenantId={tenantId}
          initialTemplates={templates}
          fetchError={error?.message ?? null}
        />
      </EmailPromotionsShell>
    </CrmShell>
  );
}
