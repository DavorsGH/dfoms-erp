export type CorrectiveActionEntry = {
  action_no: string;
  related_work_order: string | null;
  related_issue_no: string | null;
  date_raised: string;
  client_id: string | null;
  issue_description: string | null;
  responsible_person: string | null;
  target_date: string | null;
  status: string | null;
  completion_date: string | null;
  evidence_submitted: boolean | null;
  management_approval: boolean | null;
  notes: string | null;
  client?: {
    client_id: string;
    client_name: string;
  } | null;
};

export const CORRECTIVE_ACTION_SELECT =
  "*, client:customers!client_id(client_id, client_name)";

export type WorkOrderLookupOption = {
  work_order_no: string;
  date: string;
};

export type FailedIssueLookupOption = {
  issue_no: string;
  date_identified: string;
  problem_description: string | null;
};

export function normalizeCorrectiveActionEntry(
  raw: CorrectiveActionEntry,
): CorrectiveActionEntry {
  return {
    ...raw,
    client: Array.isArray(raw.client) ? raw.client[0] ?? null : raw.client ?? null,
  };
}

export function getCorrectiveActionClientName(entry: CorrectiveActionEntry): string {
  return entry.client?.client_name ?? entry.client_id ?? "—";
}

export function isCorrectiveActionOverdue(entry: CorrectiveActionEntry): boolean {
  if ((entry.status ?? "").trim() === "Completed") {
    return false;
  }

  if (!entry.target_date?.trim()) {
    return false;
  }

  const dueDate = new Date(entry.target_date.slice(0, 10));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dueDate < today;
}
