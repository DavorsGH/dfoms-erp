import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import CrmShell from "../../crm-shell";
import EmailPromotionsShell from "../email-promotions-shell";
import Campaigns from "./campaigns";
import {
  CAMPAIGN_SELECT,
  normalizeCampaignRow,
  type CampaignRow,
} from "@/utils/campaigns-types";
import {
  MESSAGE_TEMPLATE_SELECT,
  normalizeMessageTemplateRow,
  type MessageTemplateRow,
} from "@/utils/message-templates-types";

export default async function CampaignsPage() {
  const tenantId = await getCurrentUserTenantId();
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  if (!tenantId) {
    return (
      <CrmShell sectionTitle="Email & Promotions">
        <EmailPromotionsShell sectionTitle="Campaigns">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Unable to resolve tenant for campaigns.
          </p>
        </EmailPromotionsShell>
      </CrmShell>
    );
  }

  const [campaignsResult, templatesResult] = await Promise.all([
    supabase
      .from("campaigns")
      .select(CAMPAIGN_SELECT)
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
    supabase
      .from("message_templates")
      .select(MESSAGE_TEMPLATE_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
  ]);

  const campaigns = (
    (campaignsResult.data as unknown as CampaignRow[] | null) ?? []
  ).map(normalizeCampaignRow);
  const activeTemplates = (
    (templatesResult.data as MessageTemplateRow[] | null) ?? []
  ).map(normalizeMessageTemplateRow);

  const fetchError =
    campaignsResult.error?.message ?? templatesResult.error?.message ?? null;

  return (
    <CrmShell sectionTitle="Email & Promotions">
      <EmailPromotionsShell sectionTitle="Campaigns">
        <Campaigns
          tenantId={tenantId}
          initialCampaigns={campaigns}
          activeTemplates={activeTemplates}
          fetchError={fetchError}
        />
      </EmailPromotionsShell>
    </CrmShell>
  );
}
