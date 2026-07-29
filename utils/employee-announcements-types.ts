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

/** Mixed OR-union audience: criteria arrays + explicit employee IDs. */
export type EmployeeAnnouncementAudienceFiltered = {
  type: "filtered";
  positions: string[];
  shifts: string[];
  employment_types: string[];
  employee_ids: string[];
};

/**
 * Canonical stored shape. Legacy single-criterion shapes
 * (`position` / `shift` / `employment_type` / `individual`) are accepted on
 * read and normalized into `filtered`.
 */
export type EmployeeAnnouncementAudienceFilter =
  | EmployeeAnnouncementAudienceAll
  | EmployeeAnnouncementAudienceFiltered;

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

export function emptyFilteredAudience(): EmployeeAnnouncementAudienceFiltered {
  return {
    type: "filtered",
    positions: [],
    shifts: [],
    employment_types: [],
    employee_ids: [],
  };
}

export function filteredAudienceHasCriteria(
  filter: EmployeeAnnouncementAudienceFiltered,
): boolean {
  return (
    filter.positions.length > 0 ||
    filter.shifts.length > 0 ||
    filter.employment_types.length > 0 ||
    filter.employee_ids.length > 0
  );
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

  if (type === "filtered") {
    const filtered: EmployeeAnnouncementAudienceFiltered = {
      type: "filtered",
      positions: normalizeStringList(record.positions),
      shifts: normalizeStringList(record.shifts),
      employment_types: normalizeStringList(record.employment_types),
      employee_ids: normalizeStringList(record.employee_ids),
    };
    if (!filteredAudienceHasCriteria(filtered)) {
      return null;
    }
    return filtered;
  }

  // Legacy single-criterion shapes → filtered.
  if (type === "position") {
    const positions = normalizeStringList(record.value);
    if (positions.length === 0) return null;
    return { ...emptyFilteredAudience(), positions };
  }

  if (type === "shift") {
    const shifts = normalizeStringList(record.value);
    if (shifts.length === 0) return null;
    return { ...emptyFilteredAudience(), shifts };
  }

  if (type === "employment_type") {
    const employment_types = normalizeStringList(record.value);
    if (employment_types.length === 0) return null;
    return { ...emptyFilteredAudience(), employment_types };
  }

  if (type === "individual") {
    const employee_ids = normalizeStringList(record.value);
    if (employee_ids.length === 0) return null;
    return { ...emptyFilteredAudience(), employee_ids };
  }

  return null;
}

export function formatAudienceLabel(
  filter: EmployeeAnnouncementAudienceFilter,
): string {
  if (filter.type === "all") {
    return "All Employees";
  }

  const parts: string[] = [];
  if (filter.positions.length > 0) {
    parts.push(
      filter.positions.length === 1
        ? `Position: ${filter.positions[0]}`
        : `Positions: ${filter.positions.length}`,
    );
  }
  if (filter.shifts.length > 0) {
    parts.push(
      filter.shifts.length === 1
        ? `Shift: ${filter.shifts[0]}`
        : `Shifts: ${filter.shifts.length}`,
    );
  }
  if (filter.employment_types.length > 0) {
    parts.push(
      filter.employment_types.length === 1
        ? `Employment type: ${filter.employment_types[0]}`
        : `Employment types: ${filter.employment_types.length}`,
    );
  }
  if (filter.employee_ids.length > 0) {
    parts.push(
      filter.employee_ids.length === 1
        ? `Individual: 1 employee`
        : `Individuals: ${filter.employee_ids.length}`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "Filtered audience";
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
    return "Audience must be All Employees, or at least one position, shift, employment type, or named individual.";
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

/** Explicit employee IDs from a filtered audience (empty for `all`). */
export function audienceEmployeeIds(
  filter: EmployeeAnnouncementAudienceFilter,
): string[] {
  if (filter.type !== "filtered") {
    return [];
  }
  return filter.employee_ids;
}
