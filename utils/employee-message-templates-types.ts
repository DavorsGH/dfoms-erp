export const EMPLOYEE_MESSAGE_TEMPLATE_SELECT =
  "id, tenant_id, name, channel, subject, body, is_active, created_by, created_at, updated_at" as const;

export const EMPLOYEE_MESSAGE_TEMPLATE_CHANNELS = [
  "email",
  "sms",
  "both",
] as const;
export type EmployeeMessageTemplateChannel =
  (typeof EMPLOYEE_MESSAGE_TEMPLATE_CHANNELS)[number];

export type EmployeeMessageTemplateRow = {
  id: string;
  tenant_id: string;
  name: string;
  channel: EmployeeMessageTemplateChannel;
  subject: string | null;
  body: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EmployeeMessageTemplateInput = {
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

export function validateEmployeeMessageTemplateInput(
  body: EmployeeMessageTemplateInput,
): string | null {
  const name = body.name?.trim() ?? "";
  if (!name) {
    return "Template name is required.";
  }

  const channel = body.channel?.trim() ?? "";
  if (
    !EMPLOYEE_MESSAGE_TEMPLATE_CHANNELS.includes(
      channel as EmployeeMessageTemplateChannel,
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

export function trimEmployeeMessageTemplateInput(
  body: EmployeeMessageTemplateInput,
): {
  name: string;
  channel: EmployeeMessageTemplateChannel;
  subject: string | null;
  body: string;
  is_active: boolean;
} {
  const channel = (body.channel ?? "").trim() as EmployeeMessageTemplateChannel;
  const includesEmail = channelIncludesEmail(channel);

  return {
    name: (body.name ?? "").trim(),
    channel,
    subject: includesEmail ? (body.subject?.trim() || null) : null,
    body: (body.body ?? "").trim(),
    is_active: body.is_active !== false,
  };
}

export function normalizeEmployeeMessageTemplateRow(
  raw: EmployeeMessageTemplateRow,
): EmployeeMessageTemplateRow {
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
