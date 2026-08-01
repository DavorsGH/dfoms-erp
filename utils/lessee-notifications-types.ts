export const LESSEE_NOTIFICATION_SELECT =
  "id, tenant_id, recipient_user_id, lessee_id, announcement_id, title, body, read_at, created_at" as const;

export type LesseeNotificationRow = {
  id: string;
  tenant_id: string;
  recipient_user_id: string;
  lessee_id: string;
  announcement_id: string | null;
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
};

export function normalizeLesseeNotificationRow(
  raw: LesseeNotificationRow,
): LesseeNotificationRow {
  return {
    ...raw,
    announcement_id: raw.announcement_id ?? null,
    read_at: raw.read_at ?? null,
  };
}

export function isNotificationUnread(row: {
  read_at: string | null;
}): boolean {
  return row.read_at == null;
}
