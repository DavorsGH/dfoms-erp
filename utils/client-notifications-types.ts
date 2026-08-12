export const CLIENT_NOTIFICATION_SELECT =
  "id, tenant_id, recipient_user_id, client_id, announcement_id, title, body, action_url, read_at, created_at" as const;

export type ClientNotificationRow = {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  client_id: string;
  announcement_id: string | null;
  title: string;
  body: string;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

export function normalizeClientNotificationRow(raw: {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  client_id: string;
  announcement_id?: string | null;
  title: string;
  body: string;
  action_url?: string | null;
  read_at: string | null;
  created_at: string;
}): ClientNotificationRow {
  return {
    id: raw.id,
    tenant_id: raw.tenant_id,
    recipient_user_id: raw.recipient_user_id,
    client_id: raw.client_id,
    announcement_id: raw.announcement_id ?? null,
    title: raw.title,
    body: raw.body,
    action_url: raw.action_url ?? null,
    read_at: raw.read_at ?? null,
    created_at: raw.created_at,
  };
}

export function isNotificationUnread(row: { read_at: string | null }): boolean {
  return row.read_at == null;
}

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

export function resolveClientNotificationHref(row: {
  action_url: string | null;
}): string | null {
  const structured = row.action_url?.trim();
  if (!structured) return null;
  return toNotificationAppPath(structured);
}
