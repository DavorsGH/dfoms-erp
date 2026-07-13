export type LeaveManagementEntry = {
  leave_id: string;
  employee_id: string;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  days_approved: number | null;
  approval_status: string;
  leave_balance_remaining: number | null;
};

export const LEAVE_TYPE_OPTIONS = [
  "Annual Leave",
  "Sick Leave",
  "Unpaid Leave",
  "Compassionate Leave",
] as const;

export const APPROVAL_STATUS_OPTIONS = [
  "Pending",
  "Approved",
  "Rejected",
] as const;

export const DEFAULT_APPROVAL_STATUS = "Pending";
