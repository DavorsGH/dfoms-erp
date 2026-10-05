import type { MessageTemplateChannel } from "@/utils/message-templates-types";
import { CUSTOMER_TYPE_FILTER_OPTIONS } from "@/app/dashboard/crm/customers/customers-utils";

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
/** Legacy stored shape — still accepted on read and in send resolution. */
export type CampaignAudienceByCustomerType = {
  type: "customer_type";
  value: "service_client" | "digital_subscriber" | "product_client" | "all";
};
export type CampaignAudienceFiltered = {
  type: "filtered";
  customer_types: Array<
    "service_client" | "digital_subscriber" | "product_client" | "all"
  >;
  client_ids: string[];
};
export type CampaignAudienceFilter =
  | CampaignAudienceAll
  | CampaignAudienceByCustomerType
  | CampaignAudienceFiltered;

export type CampaignAudienceCustomerType =
  CampaignAudienceFiltered["customer_types"][number];

export type CampaignCustomer = {
  client_id: string;
  client_name: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  customer_type: string | null;
  status: string | null;
  [key: string]: unknown;
};

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
  template_id: string | null;
  channel: CampaignChannel;
  subject: string | null;
  body_email: string | null;
  body_sms: string | null;
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
  template_id?: string | null;
  channel?: string;
  subject?: string | null;
  body_email?: string | null;
  body_sms?: string | null;
  audience_filter?: unknown;
};

export const CAMPAIGN_SELECT =
  "id, tenant_id, campaign_code, name, template_id, channel, subject, body_email, body_sms, audience_filter, status, scheduled_at, sent_at, total_recipients, created_by, created_at, updated_at, message_templates(name, channel, is_active)" as const;

export const AUDIENCE_TYPE_OPTIONS = [
  { value: "all", label: "All customers" },
  { value: "filtered", label: "Filtered" },
] as const;

const FILTER_CUSTOMER_TYPE_VALUES = new Set<string>([
  "service_client",
  "digital_subscriber",
  "product_client",
  "all",
]);

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    const unique = new Set<string>();
    for (const item of value) {
      if (typeof item === "string" && item.trim()) {
        unique.add(item.trim());
      }
    }
    return [...unique];
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

export function emptyFilteredCampaignAudience(): CampaignAudienceFiltered {
  return { type: "filtered", customer_types: [], client_ids: [] };
}

export function filteredCampaignAudienceHasCriteria(
  filter: CampaignAudienceFiltered,
): boolean {
  return filter.customer_types.length > 0 || filter.client_ids.length > 0;
}

function normalizeCustomerTypeList(value: unknown): CampaignAudienceFiltered["customer_types"] {
  const out: CampaignAudienceFiltered["customer_types"] = [];
  for (const item of normalizeStringList(value)) {
    if (item === "both") {
      if (!out.includes("all")) out.push("all");
      continue;
    }
    if (FILTER_CUSTOMER_TYPE_VALUES.has(item)) {
      const typed = item as CampaignAudienceCustomerType;
      if (!out.includes(typed)) out.push(typed);
    }
  }
  return out;
}

export const AUDIENCE_CUSTOMER_TYPE_OPTIONS = CUSTOMER_TYPE_FILTER_OPTIONS;

export function isDraftStatus(status: string): boolean {
  return status === "draft";
}

export function formatCampaignStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatAudienceLabel(filter: CampaignAudienceFilter): string {
  if (filter.type === "all") {
    return "All customers";
  }
  if (filter.type === "customer_type") {
    const match = AUDIENCE_CUSTOMER_TYPE_OPTIONS.find(
      (option) => option.value === filter.value,
    );
    return match
      ? `Customer type: ${match.label}`
      : `Customer type: ${filter.value}`;
  }

  const parts: string[] = [];
  if (filter.customer_types.length > 0) {
    parts.push(
      filter.customer_types.length === 1
        ? `Type: ${filter.customer_types[0]}`
        : `Types: ${filter.customer_types.length}`,
    );
  }
  if (filter.client_ids.length > 0) {
    parts.push(
      filter.client_ids.length === 1
        ? "Individual: 1 customer"
        : `Individuals: ${filter.client_ids.length}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Filtered audience";
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
    let customerType =
      typeof record.value === "string" ? record.value.trim() : "";
    if (customerType === "both") {
      customerType = "all";
    }
    if (
      customerType === "service_client" ||
      customerType === "digital_subscriber" ||
      customerType === "product_client" ||
      customerType === "all"
    ) {
      return { type: "customer_type", value: customerType };
    }
  }

  if (type === "filtered") {
    const filtered: CampaignAudienceFiltered = {
      type: "filtered",
      customer_types: normalizeCustomerTypeList(record.customer_types),
      client_ids: normalizeStringList(record.client_ids),
    };
    if (!filteredCampaignAudienceHasCriteria(filtered)) {
      return null;
    }
    return filtered;
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
  if (campaignChannel === "both") {
    return false;
  }
  return templateChannel === campaignChannel;
}

export function defaultChannelFromTemplate(
  templateChannel: string,
): CampaignChannel {
  if (templateChannel === "sms") return "sms";
  if (templateChannel === "both") return "both";
  return "email";
}

export function formatCampaignChannelListLabel(channel: CampaignChannel): string {
  if (channel === "both") return "Email, SMS";
  if (channel === "sms") return "SMS";
  return "Email";
}

export function campaignChannelFromFlags(options: {
  email: boolean;
  sms: boolean;
}): CampaignChannel | null {
  if (options.email && options.sms) return "both";
  if (options.email) return "email";
  if (options.sms) return "sms";
  return null;
}

export function campaignChannelFlags(
  channel: CampaignChannel,
): { email: boolean; sms: boolean } {
  return {
    email: channel === "email" || channel === "both",
    sms: channel === "sms" || channel === "both",
  };
}

export function validateCampaignInput(body: CampaignInput): string | null {
  const name = body.name?.trim() ?? "";
  if (!name) {
    return "Campaign name is required.";
  }

  const templateId = body.template_id?.trim() ?? "";
  const bodyEmail = body.body_email?.trim() ?? "";
  const bodySms = body.body_sms?.trim() ?? "";
  const subject = body.subject?.trim() ?? "";

  if (!templateId && !bodyEmail && !bodySms) {
    return "Select a template or enter an ad-hoc message body.";
  }

  const channel = body.channel?.trim() ?? "";
  if (!CAMPAIGN_CHANNELS.includes(channel as CampaignChannel)) {
    return "Select at least one channel (email and/or SMS).";
  }

  const channelTyped = channel as CampaignChannel;
  if (!templateId) {
    if (channelTyped !== "sms" && !subject) {
      return "Email campaigns require a subject line.";
    }
    if (
      (channelTyped === "email" || channelTyped === "both") &&
      !bodyEmail
    ) {
      return "Enter an email body or select a template.";
    }
    if ((channelTyped === "sms" || channelTyped === "both") && !bodySms) {
      return "Enter an SMS body or select a template.";
    }
  }

  const audience = normalizeAudienceFilter(body.audience_filter ?? { type: "all" });
  if (!audience) {
    return "Audience must be all customers, or at least one customer type or named customer.";
  }

  return null;
}

export function trimCampaignInput(body: CampaignInput): {
  name: string;
  template_id: string | null;
  channel: CampaignChannel;
  subject: string | null;
  body_email: string | null;
  body_sms: string | null;
  audience_filter: CampaignAudienceFilter;
} {
  const templateId = (body.template_id ?? "").trim();
  return {
    name: (body.name ?? "").trim(),
    template_id: templateId || null,
    channel: (body.channel ?? "").trim() as CampaignChannel,
    subject: (body.subject ?? "").trim() || null,
    body_email: (body.body_email ?? "").trim() || null,
    body_sms: (body.body_sms ?? "").trim() || null,
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
