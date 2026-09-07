import "server-only";

import {
  fetchAttendanceSummaryReportData,
  fetchHeadcountContractExpiryReportData,
  fetchLeaveBalanceReportData,
} from "@/app/dashboard/reports/hr-report-data";
import {
  buildAttendanceSummaryReport,
  buildContractExpiryReport,
  buildHeadcountSummary,
  buildLeaveBalanceReport,
  formatContractExpiryLabel,
} from "@/app/dashboard/reports/hr-reports-utils";
import {
  canAccessHrManagementSection,
  canAccessHrPayrollSection,
} from "@/utils/rbac-access";
import {
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  loadStaffDashboardViewModel,
  pickMonthSnapshot,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import {
  EMPLOYEE_SEARCH_LIMIT,
  HR_ASSISTANT_LIST_LIMIT,
  fetchAssistantDirectoryEmployees,
  loadStaffBusinessUnitScope,
  parseOptionalStringField,
  parseRequiredStringField,
  resolveDepartmentDisplay,
  resolveEmployeeInScope,
  resolveHrAssistantPeriodSelection,
  resolveSupervisorName,
  searchEmployeesInScope,
} from "@/utils/assistant-staff-tools-hr-common";

export async function getEmployeeHeadcount(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee headcount data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const data = await fetchHeadcountContractExpiryReportData(supabase, buScope);
    const summary = buildHeadcountSummary(data.initialEmployees);

    return {
      totalActive: summary.totalActive,
      totalFullTime: summary.totalFullTime,
      totalPartTime: summary.totalPartTime,
      totalCasual: summary.totalCasual,
      totalContract: summary.totalContract,
      totalInactiveTerminated: summary.totalInactiveTerminated,
      fetchWarning: data.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_headcount threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getPayrollStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrPayrollSection(sessionResult.session.role)) {
    return { error: "You do not have access to payroll status data." };
  }

  const dashboardResult = await loadStaffDashboardViewModel();
  if ("error" in dashboardResult) {
    return dashboardResult;
  }

  const snapshot = pickMonthSnapshot(
    dashboardResult.viewModel,
    dashboardResult.viewModel.defaultMonthKey,
  );
  if (!snapshot) {
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }

  const { payroll } = snapshot;
  return {
    periodLabel: payroll.periodLabel,
    lockStatus: payroll.lockStatus,
    totalPayrollCostGhs: payroll.totalPayrollCost,
    totalPayrollCostYtdGhs: payroll.totalPayrollCostYtd,
    pendingPayrollLiabilitiesGhs: payroll.pendingPayrollLiabilities,
    liabilityReferenceLabel: payroll.liabilityReferenceLabel,
    payrollNotProcessed: payroll.payrollNotProcessed,
    fetchWarning: dashboardResult.fetchError,
  };
}

export async function searchEmployees(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee directory search." };
  }

  const query = parseRequiredStringField(toolInput, "query");
  if (!query) {
    return { error: "query is required." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employees, fetchError } = await fetchAssistantDirectoryEmployees(
      supabase,
      buScope,
    );
    if (fetchError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: fetchError };
    }

    const matches = searchEmployeesInScope(employees, query);
    const limited = matches.slice(0, EMPLOYEE_SEARCH_LIMIT);

    return {
      query,
      totalMatches: matches.length,
      employees: limited.map((employee) => ({
        employeeId: employee.employee_id,
        staffId: employee.staff_id,
        fullName: employee.full_name,
        position: employee.position?.trim() || null,
        department: resolveDepartmentDisplay(employee),
        employmentStatus: employee.employment_status?.trim() || "Active",
      })),
      note:
        matches.length > EMPLOYEE_SEARCH_LIMIT
          ? `Showing ${EMPLOYEE_SEARCH_LIMIT} of ${matches.length} matches. Refine your search for more specific results.`
          : undefined,
    };
  } catch (error) {
    console.error("[assistant] search_employees threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeProfile(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee profile data." };
  }

  const employeeId = parseRequiredStringField(toolInput, "employeeId");
  if (!employeeId) {
    return { error: "employeeId is required." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employees, fetchError } = await fetchAssistantDirectoryEmployees(
      supabase,
      buScope,
    );
    if (fetchError) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: fetchError };
    }

    const employee = resolveEmployeeInScope(employees, employeeId);
    if (!employee) {
      return {
        error:
          "No employee matched that identifier in your current business unit scope.",
      };
    }

    return {
      employeeId: employee.employee_id,
      staffId: employee.staff_id,
      fullName: employee.full_name,
      position: employee.position?.trim() || null,
      department: resolveDepartmentDisplay(employee),
      employmentType: employee.employment_type,
      employmentStatus: employee.employment_status?.trim() || "Active",
      supervisorName: resolveSupervisorName(employees, employee.supervisor),
      phone: employee.phone,
      email: employee.email,
      dateHired: employee.date_hired,
      appointmentEndDate: employee.appointment_end_date,
      shift: employee.shift,
      welfareDeductionRatePercent: employee.welfare_deduction_rate ?? null,
    };
  } catch (error) {
    console.error("[assistant] get_employee_profile threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeLeaveBalance(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee leave balance data." };
  }

  const employeeId = parseRequiredStringField(toolInput, "employeeId");
  if (!employeeId) {
    return { error: "employeeId is required." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employees, fetchError: directoryError } =
      await fetchAssistantDirectoryEmployees(supabase, buScope);
    if (directoryError) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: directoryError,
      };
    }

    const employee = resolveEmployeeInScope(employees, employeeId);
    if (!employee) {
      return {
        error:
          "No employee matched that identifier in your current business unit scope.",
      };
    }

    const currentYear = new Date().getFullYear();
    const { data, error } = await supabase
      .from("employee_leave_balances")
      .select("*, leave_types(type_name)")
      .eq("employee_id", employee.employee_id)
      .eq("year", currentYear)
      .order("leave_type_id");

    if (error) {
      console.error("[assistant] get_employee_leave_balance failed:", error.message);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const balances = (data ?? []).map((row) => {
      const leaveType = Array.isArray(row.leave_types)
        ? row.leave_types[0]
        : row.leave_types;

      return {
        leaveType: leaveType?.type_name?.trim() || "Leave",
        entitledDays: Number(row.entitled_days) || 0,
        daysUsed: Number(row.days_used) || 0,
        daysRemaining: Number(row.days_remaining) || 0,
      };
    });

    return {
      employeeId: employee.employee_id,
      staffId: employee.staff_id,
      fullName: employee.full_name,
      year: currentYear,
      balances,
      note:
        balances.length === 0
          ? `No leave entitlement rows for ${currentYear}. Balances are created from leave policy when employees are provisioned or when leave is approved.`
          : "Current-year entitlement remaining — same source as HR → Leave Balances (employee_leave_balances).",
    };
  } catch (error) {
    console.error("[assistant] get_employee_leave_balance threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeLeaveHistoryRegister(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return {
      error: "You do not have access to the manual leave register.",
    };
  }

  const employeeId = parseRequiredStringField(toolInput, "employeeId");
  if (!employeeId) {
    return { error: "employeeId is required." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employees, fetchError: directoryError } =
      await fetchAssistantDirectoryEmployees(supabase, buScope);
    if (directoryError) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: directoryError,
      };
    }

    const employee = resolveEmployeeInScope(employees, employeeId);
    if (!employee) {
      return {
        error:
          "No employee matched that identifier in your current business unit scope.",
      };
    }

    const reportData = await fetchLeaveBalanceReportData(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );
    const rows = buildLeaveBalanceReport(
      reportData.initialEmployees,
      reportData.initialLeaveEntries.filter(
        (entry) => entry.employee_id === employee.employee_id,
      ),
      "all",
    );

    return {
      employeeId: employee.employee_id,
      staffId: employee.staff_id,
      fullName: employee.full_name,
      registerEntries: rows.map((row) => ({
        leaveType: row.leaveType,
        daysRequested: row.daysRequested,
        daysApproved: row.daysApproved,
        approvalStatus: row.approvalStatus,
        leaveBalanceRemainingSnapshot: row.leaveBalanceRemaining,
      })),
      note:
        "Manual Leave register (leave_management) — recorded leave episodes from HR → Leave and the Leave Balance Report. NOT current entitlement remaining; use get_employee_leave_balance for days left.",
      fetchWarning: reportData.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_leave_history_register threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeLeaveHistory(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee leave history." };
  }

  const employeeId = parseRequiredStringField(toolInput, "employeeId");
  if (!employeeId) {
    return { error: "employeeId is required." };
  }

  const status = parseOptionalStringField(toolInput, "status");

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { employees, fetchError: directoryError } =
      await fetchAssistantDirectoryEmployees(supabase, buScope);
    if (directoryError) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: directoryError,
      };
    }

    const employee = resolveEmployeeInScope(employees, employeeId);
    if (!employee) {
      return {
        error:
          "No employee matched that identifier in your current business unit scope.",
      };
    }

    const reportData = await fetchLeaveBalanceReportData(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );
    const filteredEntries = reportData.initialLeaveEntries
      .filter((entry) => {
        if (entry.employee_id !== employee.employee_id) {
          return false;
        }

        if (!status) {
          return true;
        }

        return (
          entry.approval_status.trim().toLowerCase() === status.toLowerCase()
        );
      })
      .sort((left, right) => right.start_date.localeCompare(left.start_date));

    const limitedEntries = filteredEntries.slice(0, HR_ASSISTANT_LIST_LIMIT);

    return {
      employeeId: employee.employee_id,
      staffId: employee.staff_id,
      fullName: employee.full_name,
      statusFilter: status ?? null,
      leaveRecords: limitedEntries.map((entry) => ({
        leaveType: entry.leave_type,
        startDate: entry.start_date,
        endDate: entry.end_date,
        daysRequested: Number(entry.days_requested) || 0,
        daysApproved:
          entry.days_approved === null || entry.days_approved === undefined
            ? null
            : Number(entry.days_approved) || 0,
        approvalStatus: entry.approval_status,
        leaveBalanceRemaining:
          entry.leave_balance_remaining === null ||
          entry.leave_balance_remaining === undefined
            ? null
            : Number(entry.leave_balance_remaining) || 0,
      })),
      note:
        filteredEntries.length > HR_ASSISTANT_LIST_LIMIT
          ? `Showing ${HR_ASSISTANT_LIST_LIMIT} most recent matching records from the manual Leave register. For days remaining, use get_employee_leave_balance.`
          : "Chronological episodes from manual Leave register (leave_management). Not entitlement remaining; not self-service leave_requests unless HR entered them in Leave.",
      fetchWarning: reportData.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_leave_history threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeAttendanceSummary(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee attendance data." };
  }

  const employeeId = parseOptionalStringField(toolInput, "employeeId");
  const { period, ...selection } = resolveHrAssistantPeriodSelection(toolInput);

  if (period === "ytd") {
    return {
      error:
        "Attendance summary is available for this_month or last_month only.",
    };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();

    let scopedEmployee = null;
    if (employeeId) {
      const { employees, fetchError } = await fetchAssistantDirectoryEmployees(
        supabase,
        buScope,
      );
      if (fetchError) {
        return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: fetchError };
      }
      scopedEmployee = resolveEmployeeInScope(employees, employeeId);
      if (!scopedEmployee) {
        return {
          error:
            "No employee matched that identifier in your current business unit scope.",
        };
      }
    }

    const reportData = await fetchAttendanceSummaryReportData(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );
    const rows = buildAttendanceSummaryReport(
      selection.year,
      selection.month,
      reportData.initialEmployees,
      reportData.initialAttendanceEntries,
    ).filter((row) =>
      scopedEmployee ? row.staffId === scopedEmployee.staff_id : true,
    );

    return {
      periodLabel: selection.periodLabel,
      employees: rows.map((row) => ({
        staffId: row.staffId,
        fullName: row.fullName,
        presentDays: row.present,
        absentDays: row.absent,
        lateDays: row.late,
        onLeaveDays: row.onLeave,
        offDutyDays: row.offDuty,
        totalDaysRecorded: row.totalDaysRecorded,
      })),
      fetchWarning: reportData.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_attendance_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getContractExpiryList(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrManagementSection(sessionResult.session.role)) {
    return { error: "You do not have access to contract expiry data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const data = await fetchHeadcountContractExpiryReportData(supabase, buScope);
    const allRows = buildContractExpiryReport(data.initialEmployees);
    const rows = allRows.slice(0, HR_ASSISTANT_LIST_LIMIT);

    return {
      totalMatches: allRows.length,
      contracts: rows.map((row) => ({
        staffId: row.staffId,
        fullName: row.fullName,
        position: row.position,
        appointmentEndDate: row.appointmentEndDate,
        daysUntilOrPastExpiry: row.daysUntilOrPastExpiry,
        expiryLabel: formatContractExpiryLabel(row.daysUntilOrPastExpiry),
        isPastExpiryWhileActive: row.isPastExpiryWhileActive,
      })),
      note:
        allRows.length > HR_ASSISTANT_LIST_LIMIT
          ? `Showing ${HR_ASSISTANT_LIST_LIMIT} contracts expiring soonest. More may exist.`
          : undefined,
      fetchWarning: data.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_contract_expiry_list threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
