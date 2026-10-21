import "server-only";

import {
  STAFF_WELFARE_LEDGER_SELECT,
  calculateStaffWelfareFundBalance,
  getEntryTypeLabel,
  getWelfareFundStatusLabel,
  normalizeStaffWelfareFundEntry,
  type StaffWelfareFundLedgerEntry,
} from "@/app/dashboard/finance/staff-welfare-fund-utils";
import { fetchPayrollLiveRecalcBundle } from "@/app/dashboard/hr-payroll/payroll-live-recalc-utils";
import {
  getPeriodEndDate,
  resolveSelectedPeriod,
} from "@/app/dashboard/hr-payroll/payroll-period-utils";
import {
  calculatePayrollRow,
  countAbsencesForStaff,
  resolvePayrollPolicyCompensation,
  type PayrollEmployeeSource,
} from "@/app/dashboard/hr-payroll/payroll-processing-utils";
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
import { getActiveBusinessUnitId } from "@/utils/dashboard-auth";
import {
  HR_PAYROLL_SETTINGS_SELECT,
  normalizeHrPayrollSettingsRow,
  resolvePayrollWelfareConfigForEmployee,
  type HrPayrollSettingsRow,
} from "@/utils/hr-payroll-settings-types";
import { scopeToBusinessUnitId } from "@/utils/phase5e-key-structure";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import { canAccessHrPayrollSection } from "@/utils/rbac-access";
import { parseAssistantYearMonth } from "@/utils/assistant-period-resolve";
import {
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import {
  HR_ASSISTANT_LIST_LIMIT,
  fetchAssistantDirectoryEmployees,
  loadStaffBusinessUnitScope,
  parseOptionalStringField,
  parseRequiredStringField,
  resolveEmployeeInScope,
  resolveHrAssistantPeriodSelection,
} from "@/utils/assistant-staff-tools-hr-common";
import { payrollAbsenceSummaryAccessError } from "@/utils/assistant-staff-r55-helpers";

export { payrollAbsenceSummaryAccessError } from "@/utils/assistant-staff-r55-helpers";

const STAFF_WELFARE_FUND_HISTORY_LIMIT = 15;
const PAYROLL_ABSENCE_SUMMARY_LIMIT = HR_ASSISTANT_LIST_LIMIT;

export async function getStaffWelfareFundStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  if (!canAccessHrPayrollSection(sessionResult.session.role)) {
    return { error: "You do not have access to Staff Welfare Fund data." };
  }

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const { data, error } = await applyBusinessUnitScope(
      supabase
        .from("staff_welfare_fund_ledger")
        .select(STAFF_WELFARE_LEDGER_SELECT)
        .eq("tenant_id", sessionResult.session.tenantId)
        .neq("status", "reversed")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      buScope,
    );

    if (error) {
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE, fetchWarning: error.message };
    }

    const entries = (
      (data as StaffWelfareFundLedgerEntry[] | null) ?? []
    ).map(normalizeStaffWelfareFundEntry);
    const currentBalanceGhs = calculateStaffWelfareFundBalance(entries);
    const recentHistory = entries.slice(0, STAFF_WELFARE_FUND_HISTORY_LIMIT).map(
      (entry) => ({
        entryDate: entry.entry_date,
        periodMonth: entry.period_month,
        entryType: getEntryTypeLabel(entry.entry_type),
        amountGhs: entry.amount,
        status: getWelfareFundStatusLabel(entry.status),
        sourceType: entry.source_type,
        counterpartyName: entry.counterparty_name,
        notes: entry.notes,
      }),
    );

    return {
      currency: "GHS" as const,
      currentBalanceGhs,
      recentHistory,
      note: "Balance is open accruals and adjustments minus disbursements — same as Finance → Staff Welfare Fund.",
    };
  } catch (error) {
    console.error("[assistant] get_staff_welfare_fund_status threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

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
        business_unit_id: payrollEmployee.business_unit_id,
      },
      liveBundle.liveContext.compensationPolicyConfig,
      new Date(),
    );

    if (!policy) {
      return {
        employeeId: employee.employee_id,
        staffId: employee.staff_id,
        fullName: employee.full_name,
        welfareDeductionRatePercent:
          payrollEmployee.welfare_deduction_rate ?? null,
        note: "No compensation policy match was found for this employee's position, employment type, and shift.",
      };
    }

    const activeBusinessUnitId = await getActiveBusinessUnitId();
    const { data: settingsData, error: settingsError } = await scopeToBusinessUnitId(
      supabase
        .from("hr_payroll_settings")
        .select(HR_PAYROLL_SETTINGS_SELECT)
        .eq("tenant_id", sessionResult.session.tenantId),
      activeBusinessUnitId,
    ).maybeSingle();

    const defaultWelfareDeductionRatePercent =
      normalizeHrPayrollSettingsRow(
        settingsData as HrPayrollSettingsRow | null,
      )?.default_welfare_deduction_rate ?? null;

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
      welfareDeductionRatePercent:
        payrollEmployee.welfare_deduction_rate ?? null,
      defaultWelfareDeductionRatePercent,
      allowanceLines: policy.allowance_lines.map((line) => ({
        code: line.allowance_code,
        name: line.allowance_name,
        amountGhs: line.amount,
      })),
      note: "Resolved from Salary Settings / compensation policy (same as Payroll Processing). Welfare rate is a percentage of gross pay applied each period.",
      fetchWarning: settingsError?.message ?? null,
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
      welfareDeductionGhs: payRow.welfareDeduction,
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

export async function getPayrollAbsenceSummary(
  toolInput?: unknown,
): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  const accessError = payrollAbsenceSummaryAccessError(
    sessionResult.session.role,
  );
  if (accessError) {
    return { error: accessError };
  }

  const { year, month } = parseAssistantYearMonth(toolInput);
  const period = resolveSelectedPeriod(year, month);

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const liveBundle = await fetchPayrollLiveRecalcBundle(supabase, {
      tenantId: sessionResult.session.tenantId,
      buScope,
    });
    if (liveBundle.error) {
      return {
        error: STAFF_DATA_UNAVAILABLE_MESSAGE,
        fetchWarning: liveBundle.error,
      };
    }

    const asOf = new Date(getPeriodEndDate(period.year, period.month));
    const employeesWithAbsence: Array<{
      staffId: string;
      employeeName: string;
      absenceDays: number;
      absenceAmountGhs: number;
    }> = [];

    for (const employee of liveBundle.employees) {
      const source: PayrollEmployeeSource = {
        employee_id: employee.employee_id,
        staff_id: employee.staff_id,
        full_name: employee.full_name,
        employment_type: employee.employment_type,
        employment_status: employee.employment_status ?? null,
        date_hired: employee.date_hired ?? null,
        appointment_end_date: employee.appointment_end_date ?? null,
        position: employee.position ?? null,
        shift: employee.shift ?? null,
        basic_salary: employee.basic_salary ?? null,
        housing_allowance: employee.housing_allowance ?? null,
        transport_allowance: employee.transport_allowance ?? null,
        other_allowances: employee.other_allowances ?? null,
        welfare_deduction_rate: employee.welfare_deduction_rate ?? null,
        business_unit_id: employee.business_unit_id ?? null,
        department: employee.department ?? null,
        contract_project: employee.contract_project,
      };

      const absenceDays = countAbsencesForStaff(
        liveBundle.liveContext.attendance,
        source.staff_id,
        period.year,
        period.month,
        [],
        liveBundle.liveContext.exemptStaffIds ?? [],
      );
      if (absenceDays <= 0) {
        continue;
      }

      const policy = resolvePayrollPolicyCompensation(
        source,
        liveBundle.liveContext.compensationPolicyConfig,
        asOf,
      );
      const calculated = calculatePayrollRow(
        source,
        period,
        liveBundle.liveContext.taxConfigs,
        {
          absenceCount: absenceDays,
          overtimeAmount: 0,
          loanRepayment: 0,
        },
        { days_to_pay: period.totalWorkingDays },
        policy,
        resolvePayrollWelfareConfigForEmployee(
          source.business_unit_id,
          liveBundle.liveContext.hrPayrollSettingsRows,
        ),
      );

      employeesWithAbsence.push({
        staffId: source.staff_id,
        employeeName: source.full_name,
        absenceDays,
        absenceAmountGhs: calculated.absence_deduction,
      });
    }

    employeesWithAbsence.sort(
      (a, b) =>
        b.absenceAmountGhs - a.absenceAmountGhs ||
        a.employeeName.localeCompare(b.employeeName),
    );

    const rows = employeesWithAbsence.slice(0, PAYROLL_ABSENCE_SUMMARY_LIMIT);

    return {
      year,
      month,
      periodLabel: period.payrollMonth.slice(0, 7),
      totalEmployeesWithAbsence: employeesWithAbsence.length,
      totalAbsenceDays: Math.round(
        employeesWithAbsence.reduce((sum, row) => sum + row.absenceDays, 0) * 100,
      ) / 100,
      totalAbsenceAmountGhs: Math.round(
        employeesWithAbsence.reduce(
          (sum, row) => sum + row.absenceAmountGhs,
          0,
        ) * 100,
      ) / 100,
      employees: rows,
      truncated: employeesWithAbsence.length > rows.length,
      note: "Absence days from Absent/Half day decisions (same as Payroll Processing). absenceAmountGhs is PayrollCalculatedRow.absence_deduction.",
    };
  } catch (error) {
    console.error("[assistant] get_payroll_absence_summary threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
