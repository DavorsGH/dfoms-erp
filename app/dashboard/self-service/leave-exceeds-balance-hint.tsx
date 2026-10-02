import { WarningHint } from "@/components/feedback/warning-hint";
import type { EmployeeLeaveBalance, LeaveRequest } from "./leave-request-utils";

export function leaveBalanceKey(
  employeeId: string,
  leaveTypeId: string,
  year: number,
): string {
  return `${employeeId}:${leaveTypeId}:${year}`;
}

export function buildLeaveBalanceLookup(
  rows: ReadonlyArray<EmployeeLeaveBalance>,
): Map<string, EmployeeLeaveBalance> {
  const map = new Map<string, EmployeeLeaveBalance>();
  for (const row of rows) {
    map.set(
      leaveBalanceKey(row.employee_id, row.leave_type_id, row.year),
      row,
    );
  }
  return map;
}

export function formatLeaveExceedsBalanceCopy(options: {
  employeeLabel: string;
  leaveTypeName: string;
  year: number;
  daysRequested: number;
  daysRemaining: number | null;
}): { title: string; description: string; ariaLabel: string } {
  const typeLabel = options.leaveTypeName.trim() || "leave";
  const title = "Exceeds leave balance";
  const remainingPhrase =
    options.daysRemaining != null
      ? `${options.daysRemaining} ${typeLabel} day${options.daysRemaining === 1 ? "" : "s"} remaining for ${options.year}`
      : `insufficient ${typeLabel} balance for ${options.year}`;

  const hasHave = options.employeeLabel === "You" ? "have" : "has";
  const description = `This request is for ${options.daysRequested} day${options.daysRequested === 1 ? "" : "s"}, but ${options.employeeLabel} ${hasHave} ${remainingPhrase}. Approving it will take the balance negative or further below zero.`;

  return {
    title,
    description,
    ariaLabel: `${title}: ${options.daysRequested} days requested, ${remainingPhrase}`,
  };
}

type LeaveExceedsBalanceHintProps = {
  request: Pick<
    LeaveRequest,
    "employee_id" | "leave_type_id" | "start_date" | "days_requested" | "leave_types"
  >;
  employeeLabel: string;
  balanceLookup: Map<string, EmployeeLeaveBalance>;
};

export function LeaveExceedsBalanceHint({
  request,
  employeeLabel,
  balanceLookup,
}: LeaveExceedsBalanceHintProps) {
  const year = new Date(request.start_date).getFullYear();
  const balance = balanceLookup.get(
    leaveBalanceKey(request.employee_id, request.leave_type_id, year),
  );
  const copy = formatLeaveExceedsBalanceCopy({
    employeeLabel,
    leaveTypeName: request.leave_types?.type_name ?? "leave",
    year,
    daysRequested: Number(request.days_requested),
    daysRemaining:
      balance != null ? Number(balance.days_remaining) : null,
  });

  return (
    <WarningHint
      tone="amber"
      title={copy.title}
      description={copy.description}
      ariaLabel={copy.ariaLabel}
      className="ml-1 align-middle"
    />
  );
}
