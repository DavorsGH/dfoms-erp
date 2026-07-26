export const MESSAGE_TEMPLATE_SELECT =
  "id, tenant_id, name, template_type, channel, subject, body_email, body_sms, variables, is_active, created_by, created_at, updated_at" as const;

export const MESSAGE_TEMPLATE_TYPES = ["marketing", "transactional"] as const;
export type MessageTemplateType = (typeof MESSAGE_TEMPLATE_TYPES)[number];

export const MESSAGE_TEMPLATE_CHANNELS = ["email", "sms", "both"] as const;
export type MessageTemplateChannel = (typeof MESSAGE_TEMPLATE_CHANNELS)[number];

export type MessageTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  template_type: MessageTemplateType;
  channel: MessageTemplateChannel;
  subject: string | null;
  body_email: string | null;
  body_sms: string | null;
  variables: string[];
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MessageTemplateInput = {
  name?: string;
  template_type?: string;
  channel?: string;
  subject?: string | null;
  body_email?: string | null;
  body_sms?: string | null;
  variables?: unknown;
  is_active?: boolean;
};

export function channelIncludesEmail(channel: string): boolean {
  return channel === "email" || channel === "both";
}

export function channelIncludesSms(channel: string): boolean {
  return channel === "sms" || channel === "both";
}

export function normalizeVariables(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function parseVariablesInput(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().replace(/^\{+|\}+$/g, ""))
    .filter(Boolean);
}

export function validateMessageTemplateInput(
  body: MessageTemplateInput,
): string | null {
  const name = body.name?.trim() ?? "";
  if (!name) {
    return "Template name is required.";
  }

  const templateType = body.template_type?.trim() ?? "";
  if (
    !MESSAGE_TEMPLATE_TYPES.includes(templateType as MessageTemplateType)
  ) {
    return "Type must be marketing or transactional.";
  }

  const channel = body.channel?.trim() ?? "";
  if (!MESSAGE_TEMPLATE_CHANNELS.includes(channel as MessageTemplateChannel)) {
    return "Channel must be email, sms, or both.";
  }

  const subject = body.subject?.trim() ?? "";
  const bodyEmail = body.body_email?.trim() ?? "";
  const bodySms = body.body_sms?.trim() ?? "";

  if (channelIncludesEmail(channel)) {
    if (!subject) {
      return "Subject is required for email templates.";
    }
    if (!bodyEmail) {
      return "Email body is required when channel includes email.";
    }
  }

  if (channelIncludesSms(channel) && !bodySms) {
    return "SMS body is required when channel includes SMS.";
  }

  return null;
}

export function trimMessageTemplateInput(body: MessageTemplateInput): {
  name: string;
  template_type: MessageTemplateType;
  channel: MessageTemplateChannel;
  subject: string | null;
  body_email: string | null;
  body_sms: string | null;
  variables: string[];
  is_active: boolean;
} {
  const channel = (body.channel ?? "").trim() as MessageTemplateChannel;
  const includesEmail = channelIncludesEmail(channel);
  const includesSms = channelIncludesSms(channel);

  return {
    name: (body.name ?? "").trim(),
    template_type: (body.template_type ?? "").trim() as MessageTemplateType,
    channel,
    subject: includesEmail ? (body.subject?.trim() || null) : null,
    body_email: includesEmail ? (body.body_email?.trim() || null) : null,
    body_sms: includesSms ? (body.body_sms?.trim() || null) : null,
    variables: normalizeVariables(body.variables),
    is_active: body.is_active !== false,
  };
}

export function normalizeMessageTemplateRow(
  raw: MessageTemplateRow,
): MessageTemplateRow {
  return {
    ...raw,
    variables: normalizeVariables(raw.variables),
    subject: raw.subject ?? null,
    body_email: raw.body_email ?? null,
    body_sms: raw.body_sms ?? null,
    created_by: raw.created_by ?? null,
  };
}

export function formatTemplateTypeLabel(type: string): string {
  if (type === "marketing") return "Marketing";
  if (type === "transactional") return "Transactional";
  return type;
}

export function formatChannelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel === "sms") return "SMS";
  if (channel === "both") return "Both";
  return channel;
}
