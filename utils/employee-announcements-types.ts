export const ANNOUNCEMENT_CODE_ENTITY_TYPE = "ANNC";

export const EMPLOYEE_ANNOUNCEMENT_STATUSES = [
  "draft",
  "sending",
  "sent",
  "failed",
] as const;
export type EmployeeAnnouncementStatus =
  (typeof EMPLOYEE_ANNOUNCEMENT_STATUSES)[number];

export const EMPLOYEE_ANNOUNCEMENT_CHANNELS = [
  "email",
  "sms",
  "in_app",
] as const;
export type EmployeeAnnouncementChannel =
  (typeof EMPLOYEE_ANNOUNCEMENT_CHANNELS)[number];

export type EmployeeAnnouncementAudienceAll = { type: "all" };
export type EmployeeAnnouncementAudienceByPosition = {
  type: "position";
  value: string;
};
export type EmployeeAnnouncementAudienceByShift = {
  type: "shift";
  value: string;
};
export type EmployeeAnnouncementAudienceByEmploymentType = {
  type: "employment_type";
  value: string;
};
export type EmployeeAnnouncementAudienceByIndividual = {
  type: "individual";
  value: string | string[];
};
export type EmployeeAnnouncementAudienceFilter =
  | EmployeeAnnouncementAudienceAll
  | EmployeeAnnouncementAudienceByPosition
  | EmployeeAnnouncementAudienceByShift
  | EmployeeAnnouncementAudienceByEmploymentType
  | EmployeeAnnouncementAudienceByIndividual;

export type EmployeeAnnouncementTemplateJoin = {
  name: string;
  channel: string;
  is_active: boolean;
};

export type EmployeeAnnouncementRow = {
  id: string;
  tenant_id: string;
  announcement_code: string | null;
  name: string;
  template_id: string | null;
  channels: string[];
  subject: string | null;
  body: string | null;
  audience_filter: EmployeeAnnouncementAudienceFilter;
  status: EmployeeAnnouncementStatus;
  total_recipients: number;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  employee_message_templates?:
    | EmployeeAnnouncementTemplateJoin
    | EmployeeAnnouncementTemplateJoin[]
    | null;
};

export type NormalizedEmployeeAnnouncementRow = Omit<
  EmployeeAnnouncementRow,
  "employee_message_templates" | "channels" | "audience_filter"
> & {
  channels: EmployeeAnnouncementChannel[];
  audience_filter: EmployeeAnnouncementAudienceFilter;
  employee_message_templates: EmployeeAnnouncementTemplateJoin | null;
};

export type EmployeeAnnouncementInput = {
  name?: string;
  template_id?: string | null;
  channels?: unknown;
  subject?: string | null;
  body?: string | null;
  audience_filter?: unknown;
};

export const EMPLOYEE_ANNOUNCEMENT_SELECT =
  "id, tenant_id, announcement_code, name, template_id, channels, subject, body, audience_filter, status, total_recipients, created_by, created_at, sent_at, employee_message_templates(name, channel, is_active)" as const;

export const AUDIENCE_TYPE_OPTIONS = [
  { value: "all", label: "All Employees" },
  { value: "position", label: "By Position" },
  { value: "shift", label: "By Shift" },
  { value: "employment_type", label: "By Employment Type" },
  { value: "individual", label: "Individual Employees" },
] as const;

export function isDraftStatus(status: string): boolean {
  return status === "draft";
}

export function formatAnnouncementStatusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatAnnouncementChannelLabel(channel: string): string {
  if (channel === "email") return "Email";
  if (channel === "sms") return "SMS";
  if (channel === "in_app") return "In-app";
  return channel;
}

export function formatChannelsLabel(channels: string[]): string {
  return channels.map(formatAnnouncementChannelLabel).join(", ");
}

function normalizeAudienceValueList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return [value.trim()];
  }
  return [];
}

export function normalizeAudienceFilter(
  value: unknown,
): EmployeeAnnouncementAudienceFilter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";

  if (type === "all") {
    return { type: "all" };
  }

  if (type === "position" || type === "shift" || type === "employment_type") {
    const single =
      typeof record.value === "string" ? record.value.trim() : "";
    if (!single) {
      return null;
    }
    return { type, value: single };
  }

  if (type === "individual") {
    const ids = normalizeAudienceValueList(record.value);
    if (ids.length === 0) {
      return null;
    }
    return {
      type: "individual",
      value: ids.length === 1 ? ids[0]! : ids,
    };
  }

  return null;
}

export function formatAudienceLabel(
  filter: EmployeeAnnouncementAudienceFilter,
): string {
  if (filter.type === "all") {
    return "All Employees";
  }
  if (filter.type === "position") {
    return `Position: ${filter.value}`;
  }
  if (filter.type === "shift") {
    return `Shift: ${filter.value}`;
  }
  if (filter.type === "employment_type") {
    return `Employment type: ${filter.value}`;
  }
  const ids = Array.isArray(filter.value) ? filter.value : [filter.value];
  if (ids.length === 1) {
    return `Individual: 1 employee`;
  }
  return `Individual: ${ids.length} employees`;
}

export function normalizeChannels(value: unknown): EmployeeAnnouncementChannel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<EmployeeAnnouncementChannel>();
  for (const item of value) {
    if (
      typeof item === "string" &&
      EMPLOYEE_ANNOUNCEMENT_CHANNELS.includes(
        item as EmployeeAnnouncementChannel,
      )
    ) {
      unique.add(item as EmployeeAnnouncementChannel);
    }
  }
  return EMPLOYEE_ANNOUNCEMENT_CHANNELS.filter((channel) => unique.has(channel));
}

export function channelsIncludeEmail(channels: string[]): boolean {
  return channels.includes("email");
}

export function validateEmployeeAnnouncementInput(
  body: EmployeeAnnouncementInput,
): string | null {
  const name = body.name?.trim() ?? "";
  if (!name) {
    return "Announcement name is required.";
  }

  const channels = normalizeChannels(body.channels);
  if (channels.length === 0) {
    return "Select at least one channel (email, SMS, or in-app).";
  }

  const templateId =
    typeof body.template_id === "string" ? body.template_id.trim() : "";
  const subject = body.subject?.trim() ?? "";
  const announcementBody = body.body?.trim() ?? "";

  if (!templateId && !announcementBody) {
    return "Select a template or provide an ad-hoc message body.";
  }

  if (!templateId && channelsIncludeEmail(channels) && !subject) {
    return "Subject is required for email announcements without a template.";
  }

  const audience = normalizeAudienceFilter(
    body.audience_filter ?? { type: "all" },
  );
  if (!audience) {
    return "Audience must be All Employees, or a valid position, shift, employment type, or individual selection.";
  }

  return null;
}

export function trimEmployeeAnnouncementInput(body: EmployeeAnnouncementInput): {
  name: string;
  template_id: string | null;
  channels: EmployeeAnnouncementChannel[];
  subject: string | null;
  body: string | null;
  audience_filter: EmployeeAnnouncementAudienceFilter;
} {
  const channels = normalizeChannels(body.channels);
  const templateId =
    typeof body.template_id === "string" && body.template_id.trim()
      ? body.template_id.trim()
      : null;
  const includesEmail = channelsIncludeEmail(channels);

  return {
    name: (body.name ?? "").trim(),
    template_id: templateId,
    channels,
    subject: templateId
      ? null
      : includesEmail
        ? (body.subject?.trim() || null)
        : null,
    body: templateId ? null : (body.body?.trim() || null),
    audience_filter:
      normalizeAudienceFilter(body.audience_filter ?? { type: "all" }) ?? {
        type: "all",
      },
  };
}

export function normalizeEmployeeAnnouncementRow(
  raw: EmployeeAnnouncementRow,
): NormalizedEmployeeAnnouncementRow {
  const audience =
    normalizeAudienceFilter(raw.audience_filter) ?? ({ type: "all" } as const);
  const template = Array.isArray(raw.employee_message_templates)
    ? (raw.employee_message_templates[0] ?? null)
    : (raw.employee_message_templates ?? null);

  return {
    ...raw,
    announcement_code: raw.announcement_code ?? null,
    template_id: raw.template_id ?? null,
    channels: normalizeChannels(raw.channels),
    subject: raw.subject ?? null,
    body: raw.body ?? null,
    audience_filter: audience,
    total_recipients: Number(raw.total_recipients) || 0,
    sent_at: raw.sent_at ?? null,
    created_by: raw.created_by ?? null,
    employee_message_templates: template,
  };
}

export function audienceEmployeeIds(
  filter: EmployeeAnnouncementAudienceFilter,
): string[] {
  if (filter.type !== "individual") {
    return [];
  }
  return Array.isArray(filter.value) ? filter.value : [filter.value];
}
