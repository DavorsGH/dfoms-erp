import "server-only";

import { fetchPayrollLiveRecalcBundle } from "@/app/dashboard/hr-payroll/payroll-live-recalc-utils";
import { resolvePayrollPolicyCompensation } from "@/app/dashboard/hr-payroll/payroll-processing-utils";
import {
  fetchLoanRegisterSummaryReportData,
  fetchMonthlyPayrollSummaryReportData,
  fetchOvertimeSummaryReportData,
} from "@/app/dashboard/reports/hr-report-data";
import {
  buildLoanRegisterSummaryReport,
  buildMonthlyPayrollSummaryReport,
  buildOvertimeSummaryReport,
} from "@/app/dashboard/reports/hr-reports-utils";
import { canAccessHrPayrollSection } from "@/utils/rbac-access";
import {
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import {
  fetchAssistantDirectoryEmployees,
  loadStaffBusinessUnitScope,
  parseOptionalStringField,
  parseRequiredStringField,
  resolveEmployeeInScope,
  resolveHrAssistantPeriodSelection,
} from "@/utils/assistant-staff-tools-hr-common";

export async function getEmployeeCompensation(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrPayrollSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee compensation data." };
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

    const liveBundle = await fetchPayrollLiveRecalcBundle(supabase, {
      tenantId: sessionResult.session.tenantId,
      buScope,
    });
    if (liveBundle.error) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: liveBundle.error };
    }

    const payrollEmployee = liveBundle.employees.find(
      (row) => row.employee_id === employee.employee_id,
    );
    if (!payrollEmployee) {
      return { error: "Employee compensation data is unavailable." };
    }

    const policy = resolvePayrollPolicyCompensation(
      {
        position: payrollEmployee.position ?? null,
        employment_type: payrollEmployee.employment_type,
        shift: payrollEmployee.shift ?? null,
      },
      liveBundle.liveContext.compensationPolicyConfig,
      new Date(),
    );

    if (!policy) {
      return {
        employeeId: employee.employee_id,
        staffId: employee.staff_id,
        fullName: employee.full_name,
        note: "No compensation policy match was found for this employee's position, employment type, and shift.",
      };
    }

    return {
      employeeId: employee.employee_id,
      staffId: employee.staff_id,
      fullName: employee.full_name,
      position: employee.position,
      employmentType: employee.employment_type,
      shift: employee.shift,
      basicSalaryGhs: policy.basic_salary,
      housingAllowanceGhs: policy.housing_allowance,
      transportAllowanceGhs: policy.transport_allowance,
      otherAllowancesGhs: policy.other_allowances,
      allowanceLines: policy.allowance_lines.map((line) => ({
        code: line.allowance_code,
        name: line.allowance_name,
        amountGhs: line.amount,
      })),
      note: "Resolved from Salary Settings / compensation policy (same as Payroll Processing).",
    };
  } catch (error) {
    console.error("[assistant] get_employee_compensation threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeePayDetail(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrPayrollSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee pay detail." };
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

    const { period, ...selection } = resolveHrAssistantPeriodSelection(toolInput);
    const reportData = await fetchMonthlyPayrollSummaryReportData(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );

    if (period === "ytd") {
      return {
        error:
          "Pay detail for a single employee is available for this_month or last_month only. Use get_payroll_status for YTD totals.",
      };
    }

    const report = buildMonthlyPayrollSummaryReport(
      selection.year,
      selection.month,
      reportData.initialEmployees,
      reportData.initialMonthEndCloseRecords,
      reportData.initialPayrollHistory,
      reportData.initialPayrollProcessing,
      reportData.initialLiveContext,
    );

    const payRow = report.rows.find(
      (row) => row.staffId === employee.staff_id,
    );

    if (!payRow) {
      return {
        employeeId: employee.employee_id,
        staffId: employee.staff_id,
        fullName: employee.full_name,
        periodLabel: report.periodLabel,
        lockStatus: report.isDraft ? "Open" : "Locked",
        note: "No payroll row exists for this employee in the selected period.",
        fetchWarning: reportData.fetchError,
      };
    }

    return {
      employeeId: employee.employee_id,
      staffId: payRow.staffId,
      fullName: payRow.fullName,
      periodLabel: report.periodLabel,
      lockStatus: report.isDraft ? "Open" : "Locked",
      basicSalaryGhs: payRow.basicSalary,
      grossPayGhs: payRow.grossPay,
      employeeSsnitGhs: payRow.employeeSsnit,
      payeTaxGhs: payRow.payeTax,
      loanRepaymentGhs: payRow.loanRepayment,
      totalDeductionsGhs: payRow.totalDeductions,
      netPayGhs: payRow.netPay,
      employerSsnitCostGhs: payRow.employerSsnitCost,
      fetchWarning: reportData.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_pay_detail threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeOvertimeSummary(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrPayrollSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee overtime data." };
  }

  const employeeId = parseOptionalStringField(toolInput, "employeeId");

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { period, ...selection } = resolveHrAssistantPeriodSelection(toolInput);

    if (period === "ytd") {
      return {
        error:
          "Overtime summary is available for this_month or last_month only.",
      };
    }

    const reportData = await fetchOvertimeSummaryReportData(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );

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

    const report = buildOvertimeSummaryReport(
      selection.year,
      selection.month,
      reportData.initialEmployees,
      reportData.initialOvertimeEntries,
    );

    const rows = scopedEmployee
      ? report.rows.filter((row) => row.staffId === scopedEmployee!.staff_id)
      : report.rows;

    return {
      periodLabel: selection.periodLabel,
      totalOvertimeAmountGhs: scopedEmployee
        ? rows.reduce((sum, row) => sum + row.totalOvertimeAmount, 0)
        : report.totalOvertimeAmount,
      employees: rows.map((row) => ({
        staffId: row.staffId,
        fullName: row.fullName,
        totalOvertimeHours: row.totalOvertimeHours,
        totalOvertimeAmountGhs: row.totalOvertimeAmount,
      })),
      fetchWarning: reportData.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_overtime_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getEmployeeLoans(toolInput?: unknown): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrPayrollSection(sessionResult.session.role)) {
    return { error: "You do not have access to employee loan data." };
  }

  const employeeId = parseOptionalStringField(toolInput, "employeeId");

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const reportData = await fetchLoanRegisterSummaryReportData(
      supabase,
      sessionResult.session.tenantId,
      buScope,
    );

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

    const report = buildLoanRegisterSummaryReport(
      reportData.initialEmployees,
      reportData.initialLoans,
    );

    const rows = scopedEmployee
      ? report.rows.filter((row) => row.staffId === scopedEmployee!.staff_id)
      : report.rows;

    return {
      totalOutstandingBalanceGhs: scopedEmployee
        ? rows.reduce((sum, row) => sum + row.outstandingBalance, 0)
        : report.totalOutstandingBalance,
      loans: rows.map((row) => ({
        staffId: row.staffId,
        fullName: row.fullName,
        loanAmountGhs: row.loanAmount,
        dateIssued: row.dateIssued,
        monthlyDeductionGhs: row.monthlyDeduction,
        totalRepaidToDateGhs: row.totalRepaidToDate,
        outstandingBalanceGhs: row.outstandingBalance,
        status: row.status,
      })),
      fetchWarning: reportData.fetchError,
    };
  } catch (error) {
    console.error("[assistant] get_employee_loans threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
