import type { MessageTemplateChannel } from "@/utils/message-templates-types";
import { CUSTOMER_TYPE_OPTIONS } from "@/app/dashboard/crm/customers/customers-utils";

export const CAMPAIGN_CODE_ENTITY_TYPE = "CAMP";

export const CAMPAIGN_STATUSES = [
  "draft",
  "scheduled",
  "sending",
  "sent",
  "failed",
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_CHANNELS = ["email", "sms", "both"] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export type CampaignAudienceAll = { type: "all" };
export type CampaignAudienceByCustomerType = {
  type: "customer_type";
  value: "service_client" | "digital_subscriber" | "both";
};
export type CampaignAudienceFilter =
  | CampaignAudienceAll
  | CampaignAudienceByCustomerType;

export type CampaignTemplateJoin = {
  name: string;
  channel: MessageTemplateChannel;
  is_active: boolean;
};

export type CampaignRow = {
  id: string;
  tenant_id: string;
  campaign_code: string | null;
  name: string;
  template_id: string;
  channel: CampaignChannel;
  audience_filter: CampaignAudienceFilter;
  status: CampaignStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  total_recipients: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  message_templates?: CampaignTemplateJoin | CampaignTemplateJoin[] | null;
};

export type NormalizedCampaignRow = Omit<CampaignRow, "message_templates"> & {
  message_templates: CampaignTemplateJoin | null;
};

export type CampaignInput = {
  name?: string;
  template_id?: string;
  channel?: string;
  audience_filter?: unknown;
};

export const CAMPAIGN_SELECT =
  "id, tenant_id, campaign_code, name, template_id, channel, audience_filter, status, scheduled_at, sent_at, total_recipients, created_by, created_at, updated_at, message_templates(name, channel, is_active)" as const;

export const AUDIENCE_TYPE_OPTIONS = [
  { value: "all", label: "All Customers" },
  { value: "customer_type", label: "By Customer Type" },
] as const;

export const AUDIENCE_CUSTOMER_TYPE_OPTIONS = CUSTOMER_TYPE_OPTIONS;

export function isDraftStatus(status: string): boolean {
  return status === "draft";
}

export function formatCampaignStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatAudienceLabel(filter: CampaignAudienceFilter): string {
  if (filter.type === "all") {
    return "All Customers";
  }
  const match = AUDIENCE_CUSTOMER_TYPE_OPTIONS.find(
    (option) => option.value === filter.value,
  );
  return match ? `Customer type: ${match.label}` : `Customer type: ${filter.value}`;
}

export function normalizeAudienceFilter(
  value: unknown,
): CampaignAudienceFilter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";

  if (type === "all") {
    return { type: "all" };
  }

  if (type === "customer_type") {
    const customerType =
      typeof record.value === "string" ? record.value.trim() : "";
    if (
      customerType === "service_client" ||
      customerType === "digital_subscriber" ||
      customerType === "both"
    ) {
      return { type: "customer_type", value: customerType };
    }
  }

  return null;
}

export function channelsCompatible(
  templateChannel: string,
  campaignChannel: string,
): boolean {
  if (templateChannel === "both") {
    return CAMPAIGN_CHANNELS.includes(campaignChannel as CampaignChannel);
  }
  // Template locked to one channel — campaign must match exactly.
  return templateChannel === campaignChannel;
}

export function defaultChannelFromTemplate(
  templateChannel: string,
): CampaignChannel {
  if (templateChannel === "sms") return "sms";
  if (templateChannel === "both") return "both";
  return "email";
}

export function validateCampaignInput(body: CampaignInput): string | null {
  const name = body.name?.trim() ?? "";
  if (!name) {
    return "Campaign name is required.";
  }

  const templateId = body.template_id?.trim() ?? "";
  if (!templateId) {
    return "Select a message template.";
  }

  const channel = body.channel?.trim() ?? "";
  if (!CAMPAIGN_CHANNELS.includes(channel as CampaignChannel)) {
    return "Channel must be email, sms, or both.";
  }

  const audience = normalizeAudienceFilter(body.audience_filter ?? { type: "all" });
  if (!audience) {
    return "Audience must be All Customers or a valid customer type.";
  }

  return null;
}

export function trimCampaignInput(body: CampaignInput): {
  name: string;
  template_id: string;
  channel: CampaignChannel;
  audience_filter: CampaignAudienceFilter;
} {
  return {
    name: (body.name ?? "").trim(),
    template_id: (body.template_id ?? "").trim(),
    channel: (body.channel ?? "").trim() as CampaignChannel,
    audience_filter:
      normalizeAudienceFilter(body.audience_filter ?? { type: "all" }) ?? {
        type: "all",
      },
  };
}

export function normalizeCampaignRow(raw: CampaignRow): NormalizedCampaignRow {
  const audience =
    normalizeAudienceFilter(raw.audience_filter) ?? ({ type: "all" } as const);
  const template = Array.isArray(raw.message_templates)
    ? (raw.message_templates[0] ?? null)
    : (raw.message_templates ?? null);

  return {
    ...raw,
    campaign_code: raw.campaign_code ?? null,
    audience_filter: audience,
    total_recipients: Number(raw.total_recipients) || 0,
    scheduled_at: raw.scheduled_at ?? null,
    sent_at: raw.sent_at ?? null,
    created_by: raw.created_by ?? null,
    message_templates: template,
  };
}
