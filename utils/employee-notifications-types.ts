export const EMPLOYEE_NOTIFICATION_SELECT =
  "id, tenant_id, recipient_user_id, announcement_id, title, body, action_url, read_at, created_at" as const;

/** Pre-migration select used when `action_url` column is not yet applied. */
export const EMPLOYEE_NOTIFICATION_SELECT_LEGACY =
  "id, tenant_id, recipient_user_id, announcement_id, title, body, read_at, created_at" as const;

export type EmployeeNotificationRow = {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  announcement_id: string | null;
  title: string;
  body: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

export function isMissingActionUrlColumnError(message: string | null | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("action_url") && (
    lower.includes("does not exist") ||
    lower.includes("could not find") ||
    lower.includes("schema cache") ||
    lower.includes("column")
  );
}

/** Match a trailing absolute or dashboard-relative URL line (legacy body embeds). */
const TRAILING_URL_LINE =
  /(?:^|\n)((?:https?:\/\/[^\s]+)|(?:\/dashboard\/[^\s]+))\s*$/i;

export function normalizeEmployeeNotificationRow(raw: {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  announcement_id: string | null;
  title: string;
  body: string;
  action_url?: string | null;
  read_at: string | null;
  created_at: string;
}): EmployeeNotificationRow {
  return {
    id: raw.id,
    tenant_id: raw.tenant_id,
    recipient_user_id: raw.recipient_user_id,
    announcement_id: raw.announcement_id ?? null,
    title: raw.title,
    body: raw.body,
    action_url: raw.action_url ?? null,
    read_at: raw.read_at ?? null,
    created_at: raw.created_at,
  };
}

export function isNotificationUnread(row: {
  read_at: string | null;
}): boolean {
  return row.read_at == null;
}

/** Convert absolute site URLs to in-app paths; leave relative paths as-is. */
export function toNotificationAppPath(urlOrPath: string): string {
  const trimmed = urlOrPath.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return trimmed;
  }
}

/**
 * Prefer structured action_url; fall back to a trailing URL line in body for
 * notifications created before action_url existed.
 */
export function resolveNotificationHref(row: {
  action_url: string | null;
  body: string;
}): string | null {
  const structured = row.action_url?.trim();
  if (structured) {
    return toNotificationAppPath(structured);
  }

  const match = row.body.match(TRAILING_URL_LINE);
  if (!match?.[1]) return null;
  return toNotificationAppPath(match[1]);
}

/** Body text without a dangling destination URL (structured or legacy trailing). */
export function displayNotificationBody(row: {
  action_url: string | null;
  body: string;
}): string {
  const href = resolveNotificationHref(row);
  let body = row.body;

  if (href) {
    const absoluteSuffix = row.action_url?.trim();
    if (absoluteSuffix && body.includes(absoluteSuffix)) {
      body = body.replace(absoluteSuffix, "");
    }
    // Strip absolute form that might still be in legacy bodies.
    body = body.replace(TRAILING_URL_LINE, "");
    // Also strip a trailing relative dashboard path line.
    const relativeEscaped = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    body = body.replace(new RegExp(`(?:^|\\n)${relativeEscaped}\\s*$`), "");
  } else {
    body = body.replace(TRAILING_URL_LINE, "");
  }

  return body.replace(/\n{3,}/g, "\n\n").trimEnd();
}
