export const LESSEE_ANNOUNCEMENT_CODE_ENTITY_TYPE = "LANNC";

export const LESSEE_ANNOUNCEMENT_STATUSES = [
  "draft",
  "sending",
  "sent",
  "failed",
] as const;
export type LesseeAnnouncementStatus =
  (typeof LESSEE_ANNOUNCEMENT_STATUSES)[number];

export const LESSEE_ANNOUNCEMENT_CHANNELS = [
  "email",
  "sms",
  "in_app",
] as const;
export type LesseeAnnouncementChannel =
  (typeof LESSEE_ANNOUNCEMENT_CHANNELS)[number];

export type LesseeAnnouncementAudienceAll = { type: "all" };

/** Mixed OR-union audience: properties ∪ leases ∪ named lessees. */
export type LesseeAnnouncementAudienceFiltered = {
  type: "filtered";
  property_ids: string[];
  lease_ids: string[];
  lessee_ids: string[];
};

export type LesseeAnnouncementAudienceFilter =
  | LesseeAnnouncementAudienceAll
  | LesseeAnnouncementAudienceFiltered;

export type LesseeAnnouncementTemplateJoin = {
  name: string;
  channel: string;
  is_active: boolean;
};

export type LesseeAnnouncementRow = {
  id: string;
  tenant_id: string;
  announcement_code: string | null;
  name: string;
  template_id: string | null;
  channels: string[];
  subject: string | null;
  body: string | null;
  audience_filter: LesseeAnnouncementAudienceFilter;
  status: LesseeAnnouncementStatus;
  total_recipients: number;
  created_by: string | null;
  created_at: string;
  sent_at: string | null;
  lessee_message_templates?:
    | LesseeAnnouncementTemplateJoin
    | LesseeAnnouncementTemplateJoin[]
    | null;
};

export type NormalizedLesseeAnnouncementRow = Omit<
  LesseeAnnouncementRow,
  "lessee_message_templates" | "channels" | "audience_filter"
> & {
  channels: LesseeAnnouncementChannel[];
  audience_filter: LesseeAnnouncementAudienceFilter;
  lessee_message_templates: LesseeAnnouncementTemplateJoin | null;
};

export type LesseeAnnouncementInput = {
  name?: string;
  template_id?: string | null;
  channels?: unknown;
  subject?: string | null;
  body?: string | null;
  audience_filter?: unknown;
};

export const LESSEE_ANNOUNCEMENT_SELECT =
  "id, tenant_id, announcement_code, name, template_id, channels, subject, body, audience_filter, status, total_recipients, created_by, created_at, sent_at, lessee_message_templates(name, channel, is_active)" as const;

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

export function emptyFilteredAudience(): LesseeAnnouncementAudienceFiltered {
  return {
    type: "filtered",
    property_ids: [],
    lease_ids: [],
    lessee_ids: [],
  };
}

export function filteredAudienceHasCriteria(
  filter: LesseeAnnouncementAudienceFiltered,
): boolean {
  return (
    filter.property_ids.length > 0 ||
    filter.lease_ids.length > 0 ||
    filter.lessee_ids.length > 0
  );
}

export function normalizeAudienceFilter(
  value: unknown,
): LesseeAnnouncementAudienceFilter | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "";

  if (type === "all") {
    return { type: "all" };
  }

  if (type === "filtered") {
    const filtered: LesseeAnnouncementAudienceFiltered = {
      type: "filtered",
      property_ids: normalizeStringList(record.property_ids),
      lease_ids: normalizeStringList(record.lease_ids),
      lessee_ids: normalizeStringList(record.lessee_ids),
    };
    if (!filteredAudienceHasCriteria(filtered)) {
      return null;
    }
    return filtered;
  }

  return null;
}

export function formatAudienceLabel(
  filter: LesseeAnnouncementAudienceFilter,
): string {
  if (filter.type === "all") {
    return "All Tenants";
  }

  const parts: string[] = [];
  if (filter.property_ids.length > 0) {
    parts.push(
      filter.property_ids.length === 1
        ? "Property: 1"
        : `Properties: ${filter.property_ids.length}`,
    );
  }
  if (filter.lease_ids.length > 0) {
    parts.push(
      filter.lease_ids.length === 1
        ? "Lease/unit: 1"
        : `Leases/units: ${filter.lease_ids.length}`,
    );
  }
  if (filter.lessee_ids.length > 0) {
    parts.push(
      filter.lessee_ids.length === 1
        ? "Individual: 1 tenant"
        : `Individuals: ${filter.lessee_ids.length}`,
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "Filtered audience";
}

export function normalizeChannels(value: unknown): LesseeAnnouncementChannel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<LesseeAnnouncementChannel>();
  for (const item of value) {
    if (
      typeof item === "string" &&
      LESSEE_ANNOUNCEMENT_CHANNELS.includes(
        item as LesseeAnnouncementChannel,
      )
    ) {
      unique.add(item as LesseeAnnouncementChannel);
    }
  }
  return LESSEE_ANNOUNCEMENT_CHANNELS.filter((channel) => unique.has(channel));
}

export function channelsIncludeEmail(channels: string[]): boolean {
  return channels.includes("email");
}

export function validateLesseeAnnouncementInput(
  body: LesseeAnnouncementInput,
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
    return "Audience must be All Tenants, or at least one property, lease/unit, or named tenant.";
  }

  return null;
}

export function trimLesseeAnnouncementInput(body: LesseeAnnouncementInput): {
  name: string;
  template_id: string | null;
  channels: LesseeAnnouncementChannel[];
  subject: string | null;
  body: string | null;
  audience_filter: LesseeAnnouncementAudienceFilter;
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

export function normalizeLesseeAnnouncementRow(
  raw: LesseeAnnouncementRow,
): NormalizedLesseeAnnouncementRow {
  const audience =
    normalizeAudienceFilter(raw.audience_filter) ?? ({ type: "all" } as const);
  const template = Array.isArray(raw.lessee_message_templates)
    ? (raw.lessee_message_templates[0] ?? null)
    : (raw.lessee_message_templates ?? null);

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
    lessee_message_templates: template,
  };
}
