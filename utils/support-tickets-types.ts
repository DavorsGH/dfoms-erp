export type SupportTicketStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed";

export type SupportTicketRow = {
  id: string;
  tenant_id: string;
  submitted_by: string;
  subject: string;
  description: string;
  status: SupportTicketStatus;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportTicketListRow = SupportTicketRow & {
  tenant_name?: string | null;
};

export const SUPPORT_TICKET_STATUSES: readonly SupportTicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

export const SUPPORT_TICKETS_PAGE_SIZE = 25;

export function parseSupportTicketStatusFilter(
  value: string | undefined,
): SupportTicketStatus | "" {
  if (value && SUPPORT_TICKET_STATUSES.includes(value as SupportTicketStatus)) {
    return value as SupportTicketStatus;
  }
  return "";
}

export function parseSupportTicketPage(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export function formatSupportTicketStatus(status: SupportTicketStatus): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isTerminalSupportTicketStatus(status: SupportTicketStatus): boolean {
  return status === "resolved" || status === "closed";
}
