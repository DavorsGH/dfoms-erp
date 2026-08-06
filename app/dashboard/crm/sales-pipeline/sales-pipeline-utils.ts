import type { HrEmployee } from "../../hr-payroll/employee-utils";
import { getEmployeeDisplayName } from "../../hr-payroll/employee-utils";

export type PipelineClient = {
  client_id: string;
  client_name: string;
  status: string | null;
};

export type OpportunityStage =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal_sent"
  | "negotiation"
  | "won"
  | "lost";

export type SalesActivityType = "call" | "email" | "meeting" | "task" | "note";

export type SalesOpportunity = {
  id: string;
  tenant_id: string;
  client_id: string;
  opportunity_name: string;
  stage: OpportunityStage;
  estimated_value: number | null;
  probability: number | null;
  expected_close_date: string | null;
  source: string | null;
  assigned_to: string | null;
  lost_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

export type SalesActivity = {
  id: string;
  tenant_id: string;
  opportunity_id: string | null;
  client_id: string | null;
  activity_type: SalesActivityType;
  due_date: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  notes: string | null;
  created_at: string;
};

export const SALES_OPPORTUNITY_SELECT =
  "id, tenant_id, client_id, opportunity_name, stage, estimated_value, probability, expected_close_date, source, assigned_to, lost_reason, notes, created_at, updated_at, closed_at";

export const SALES_ACTIVITY_SELECT =
  "id, tenant_id, opportunity_id, client_id, activity_type, due_date, completed_at, assigned_to, notes, created_at";

export const PIPELINE_CLIENT_SELECT = "client_id, client_name, status";

export const OPPORTUNITY_STAGES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "proposal_sent", label: "Proposal Sent" },
  { value: "negotiation", label: "Negotiation" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
] as const satisfies ReadonlyArray<{
  value: OpportunityStage;
  label: string;
}>;

export const ACTIVITY_TYPE_OPTIONS = [
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "task", label: "Task" },
  { value: "note", label: "Note" },
] as const satisfies ReadonlyArray<{
  value: SalesActivityType;
  label: string;
}>;

export function normalizeSalesOpportunity(raw: SalesOpportunity): SalesOpportunity {
  return {
    ...raw,
    stage: raw.stage as OpportunityStage,
    estimated_value:
      raw.estimated_value == null ? null : Number(raw.estimated_value) || 0,
    probability:
      raw.probability == null ? null : Number(raw.probability) || 0,
    expected_close_date: raw.expected_close_date?.slice(0, 10) ?? null,
  };
}

export function normalizeSalesActivity(raw: SalesActivity): SalesActivity {
  return {
    ...raw,
    activity_type: raw.activity_type as SalesActivityType,
    due_date: raw.due_date?.slice(0, 10) ?? null,
  };
}

export function getOpportunityStageLabel(stage: string | null | undefined): string {
  if (!stage) return "—";
  const match = OPPORTUNITY_STAGES.find((option) => option.value === stage);
  return match?.label ?? stage;
}

export function getActivityTypeLabel(type: string | null | undefined): string {
  if (!type) return "—";
  const match = ACTIVITY_TYPE_OPTIONS.find((option) => option.value === type);
  return match?.label ?? type;
}

export function getClientName(
  clients: PipelineClient[],
  clientId: string | null | undefined,
): string {
  if (!clientId) return "—";
  return (
    clients.find((client) => client.client_id === clientId)?.client_name ??
    clientId
  );
}

export function getAssignedRepLabel(
  employees: HrEmployee[],
  employeeId: string | null | undefined,
): string {
  if (!employeeId) return "Unassigned";
  const employee = employees.find((item) => item.employee_id === employeeId);
  if (!employee) return employeeId;
  return `${employee.staff_id} — ${getEmployeeDisplayName(employees, employeeId)}`;
}

export function groupOpportunitiesByStage(
  opportunities: SalesOpportunity[],
): Record<OpportunityStage, SalesOpportunity[]> {
  const grouped = Object.fromEntries(
    OPPORTUNITY_STAGES.map((stage) => [stage.value, [] as SalesOpportunity[]]),
  ) as Record<OpportunityStage, SalesOpportunity[]>;

  for (const opportunity of opportunities) {
    const stage = opportunity.stage;
    if (stage in grouped) {
      grouped[stage as OpportunityStage].push(opportunity);
    }
  }

  for (const stage of OPPORTUNITY_STAGES) {
    grouped[stage.value].sort((left, right) =>
      left.opportunity_name.localeCompare(right.opportunity_name),
    );
  }

  return grouped;
}

export function isActivityComplete(activity: SalesActivity): boolean {
  return Boolean(activity.completed_at);
}
