export type LeaveType = {
  id: string;
  type_name: string;
  default_annual_entitlement: number | null;
};

export type EmployeeLeaveBalance = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  year: number;
  entitled_days: number;
  days_used: number;
  days_remaining: number;
  leave_types?: Pick<LeaveType, "type_name"> | null;
};

export type LeaveRequestStatus =
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Cancelled";

export type LeaveRequest = {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  reason: string | null;
  status: LeaveRequestStatus;
  approver_user_account_id: string;
  exceeds_balance: boolean;
  decided_at: string | null;
  decision_notes: string | null;
  submitted_at: string;
  leave_types?: Pick<LeaveType, "type_name"> | null;
  employees?: { full_name: string; staff_id: string } | null;
};

export type LeaveApproverConfig = {
  id: string;
  approver_user_account_id: string;
  effective_from: string;
  notes: string | null;
  created_at: string;
  user_accounts?: {
    email: string;
    employees?: { full_name: string } | null;
  } | null;
};
