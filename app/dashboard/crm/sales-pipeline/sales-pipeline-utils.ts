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

export type OpportunityFormState = {
  client_id: string;
  opportunity_name: string;
  estimated_value: string;
  probability: string;
  expected_close_date: string;
  source: string;
  assigned_to: string;
  notes: string;
};

export const emptyOpportunityForm = (): OpportunityFormState => ({
  client_id: "",
  opportunity_name: "",
  estimated_value: "",
  probability: "",
  expected_close_date: "",
  source: "",
  assigned_to: "",
  notes: "",
});

export function opportunityToFormState(
  opportunity: SalesOpportunity,
): OpportunityFormState {
  return {
    client_id: opportunity.client_id,
    opportunity_name: opportunity.opportunity_name,
    estimated_value:
      opportunity.estimated_value == null
        ? ""
        : String(opportunity.estimated_value),
    probability:
      opportunity.probability == null ? "" : String(opportunity.probability),
    expected_close_date: opportunity.expected_close_date ?? "",
    source: opportunity.source ?? "",
    assigned_to: opportunity.assigned_to ?? "",
    notes: opportunity.notes ?? "",
  };
}

export type ParsedOpportunityForm = {
  client_id: string;
  opportunity_name: string;
  estimated_value: number | null;
  probability: number | null;
  expected_close_date: string | null;
  source: string | null;
  assigned_to: string | null;
  notes: string | null;
};

export function parseOpportunityForm(
  form: OpportunityFormState,
): { ok: true; value: ParsedOpportunityForm } | { ok: false; error: string } {
  const clientId = form.client_id.trim();
  if (!clientId) {
    return { ok: false, error: "Select a customer." };
  }

  const opportunityName = form.opportunity_name.trim();
  if (!opportunityName) {
    return { ok: false, error: "Opportunity name is required." };
  }

  const estimatedValue = form.estimated_value.trim()
    ? Number.parseFloat(form.estimated_value)
    : null;
  if (
    form.estimated_value.trim() &&
    (estimatedValue == null || Number.isNaN(estimatedValue) || estimatedValue < 0)
  ) {
    return { ok: false, error: "Estimated value must be a valid non-negative number." };
  }

  const probability = form.probability.trim()
    ? Number.parseInt(form.probability, 10)
    : null;
  if (
    form.probability.trim() &&
    (probability == null ||
      Number.isNaN(probability) ||
      probability < 0 ||
      probability > 100)
  ) {
    return { ok: false, error: "Probability must be between 0 and 100." };
  }

  return {
    ok: true,
    value: {
      client_id: clientId,
      opportunity_name: opportunityName,
      estimated_value: estimatedValue,
      probability,
      expected_close_date: form.expected_close_date.trim() || null,
      source: form.source.trim() || null,
      assigned_to: form.assigned_to.trim() || null,
      notes: form.notes.trim() || null,
    },
  };
}
