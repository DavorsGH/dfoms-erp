export type ExitManagementEntry = {
  id: string;
  employee_id: string;
  exit_date: string;
  exit_reason: string | null;
  notice_period_days: number | null;
  final_settlement: number | null;
};

/** Fixed set for the form dropdown — adjust if business wants different labels. */
export const EXIT_REASON_OPTIONS = [
  "Resignation",
  "Termination",
  "End of Contract",
  "Retirement",
  "Redundancy",
  "Death",
] as const;

export type ExitReason = (typeof EXIT_REASON_OPTIONS)[number];

export const EXIT_MANAGEMENT_SELECT =
  "id, employee_id, exit_date, exit_reason, notice_period_days, final_settlement";
