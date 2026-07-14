import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePayrollMonthValue } from "./hr-payroll/payroll-period-utils";

export type EmployeeDashboardSummary = {
  employeeName: string;
  periodLabel: string;
  attendanceRecorded: number;
  presentDays: number;
  leaveBalances: Array<{
    typeName: string;
    remaining: number;
  }>;
  pendingLeaveRequests: number;
  latestPayslipMonth: string | null;
};

function currentMonthBounds() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);

  return {
    periodLabel: start.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    }),
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
    year,
  };
}

export async function buildEmployeeDashboardSummary(
  supabase: SupabaseClient,
  employeeId: string,
): Promise<{ summary: EmployeeDashboardSummary | null; fetchError: string | null }> {
  const { periodLabel, startIso, endIso, year } = currentMonthBounds();

  const { data: employee, error: employeeError } = await supabase
    .from("employees")
    .select("full_name, staff_id")
    .eq("employee_id", employeeId)
    .maybeSingle();

  if (employeeError) {
    return { summary: null, fetchError: employeeError.message };
  }

  if (!employee?.staff_id) {
    return {
      summary: null,
      fetchError: "Employee record is missing a staff ID.",
    };
  }

  const [
    { data: attendance, error: attendanceError },
    { data: balances, error: balancesError },
    { data: leaveRequests, error: leaveError },
    { data: payrollHistory, error: payrollError },
  ] = await Promise.all([
    supabase
      .from("attendance_register")
      .select("date, attendance_status")
      .eq("staff_id", employee.staff_id)
      .gte("date", startIso)
      .lte("date", endIso),
    supabase
      .from("employee_leave_balances")
      .select("days_remaining, leave_types(type_name)")
      .eq("employee_id", employeeId)
      .eq("year", year),
    supabase
      .from("leave_requests")
      .select("status")
      .eq("employee_id", employeeId),
    supabase
      .from("payroll_history")
      .select("payroll_month")
      .eq("employee_id", employeeId)
      .order("payroll_month", { ascending: false })
      .limit(1),
  ]);

  if (attendanceError || balancesError) {
    return {
      summary: null,
      fetchError:
        attendanceError?.message ?? balancesError?.message ?? null,
    };
  }

  const fetchError = leaveError?.message ?? payrollError?.message ?? null;

  const attendanceRows = attendance ?? [];
  const presentDays = attendanceRows.filter((row) => {
    const status = (row.attendance_status ?? "").trim().toLowerCase();
    return status === "present";
  }).length;

  const leaveBalances = (balances ?? []).map((row) => {
    const leaveType = Array.isArray(row.leave_types)
      ? row.leave_types[0]
      : row.leave_types;
    return {
      typeName: leaveType?.type_name ?? "Leave",
      remaining: Number(row.days_remaining) || 0,
    };
  });

  const pendingLeaveRequests = (leaveRequests ?? []).filter(
    (row) => (row.status ?? "").trim().toLowerCase() === "pending",
  ).length;

  const latestPayslipMonth = payrollHistory?.[0]?.payroll_month
    ? normalizePayrollMonthValue(payrollHistory[0].payroll_month)
    : null;

  return {
    summary: {
      employeeName: employee.full_name,
      periodLabel,
      attendanceRecorded: attendanceRows.length,
      presentDays,
      leaveBalances,
      pendingLeaveRequests,
      latestPayslipMonth,
    },
    fetchError,
  };
}
