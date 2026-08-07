export type SystemEventType = "webhook" | "cron" | "payment";
export type SystemEventStatus = "success" | "failure" | "warning";

export type SystemEventLogRow = {
  id: string;
  event_type: SystemEventType;
  event_name: string;
  status: SystemEventStatus;
  message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export const SYSTEM_EVENT_LOG_PAGE_SIZE = 25;

export const SYSTEM_EVENT_TYPE_VALUES: readonly SystemEventType[] = [
  "webhook",
  "cron",
  "payment",
];

export const SYSTEM_EVENT_STATUS_VALUES: readonly SystemEventStatus[] = [
  "success",
  "failure",
  "warning",
];

export function parseSystemEventTypeFilter(
  value: string | undefined,
): SystemEventType | "" {
  if (value && SYSTEM_EVENT_TYPE_VALUES.includes(value as SystemEventType)) {
    return value as SystemEventType;
  }
  return "";
}

export function parseSystemEventStatusFilter(
  value: string | undefined,
): SystemEventStatus | "" {
  if (value && SYSTEM_EVENT_STATUS_VALUES.includes(value as SystemEventStatus)) {
    return value as SystemEventStatus;
  }
  return "";
}

export function parseSystemEventPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
