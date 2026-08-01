export const LESSEE_MESSAGE_TEMPLATE_SELECT =
  "id, tenant_id, name, channel, subject, body, is_active, created_by, created_at, updated_at" as const;

export const LESSEE_MESSAGE_TEMPLATE_CHANNELS = [
  "email",
  "sms",
  "both",
] as const;
export type LesseeMessageTemplateChannel =
  (typeof LESSEE_MESSAGE_TEMPLATE_CHANNELS)[number];

export type LesseeMessageTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  channel: LesseeMessageTemplateChannel;
  subject: string | null;
  body: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type LesseeMessageTemplateInput = {
  name?: string;
  channel?: string;
  subject?: string | null;
  body?: string | null;
  is_active?: boolean;
};

export function channelIncludesEmail(channel: string): boolean {
  return channel === "email" || channel === "both";
}

export function channelIncludesSms(channel: string): boolean {
  return channel === "sms" || channel === "both";
}

export function validateLesseeMessageTemplateInput(
  body: LesseeMessageTemplateInput,
): string | null {
  const name = body.name?.trim() ?? "";
  if (!name) {
    return "Template name is required.";
  }

  const channel = body.channel?.trim() ?? "";
  if (
    !LESSEE_MESSAGE_TEMPLATE_CHANNELS.includes(
      channel as LesseeMessageTemplateChannel,
    )
  ) {
    return "Channel must be email, sms, or both.";
  }

  const subject = body.subject?.trim() ?? "";
  const templateBody = body.body?.trim() ?? "";

  if (!templateBody) {
    return "Body is required.";
  }

  if (channelIncludesEmail(channel) && !subject) {
    return "Subject is required for email templates.";
  }

  return null;
}

export function trimLesseeMessageTemplateInput(
  body: LesseeMessageTemplateInput,
): {
  name: string;
  channel: LesseeMessageTemplateChannel;
  subject: string | null;
  body: string;
  is_active: boolean;
} {
  const channel = (body.channel ?? "").trim() as LesseeMessageTemplateChannel;
  const includesEmail = channelIncludesEmail(channel);

  return {
    name: (body.name ?? "").trim(),
    channel,
    subject: includesEmail ? (body.subject?.trim() || null) : null,
    body: (body.body ?? "").trim(),
    is_active: body.is_active !== false,
  };
}

export function normalizeLesseeMessageTemplateRow(
  raw: LesseeMessageTemplateRow,
): LesseeMessageTemplateRow {
  return {
    ...raw,
    subject: raw.subject ?? null,
    created_by: raw.created_by ?? null,
  };
}

export function formatChannelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel === "sms") return "SMS";
  if (channel === "both") return "Both";
  return channel;
}
