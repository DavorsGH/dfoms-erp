import {
  isActiveEmployee,
  wasEmployedDuringPayrollPeriod,
  type HrEmployee,
} from "../hr-payroll/employee-utils";
import {
  calculateLoanOutstanding,
  getLoanStatus,
} from "../hr-payroll/hr-register-utils";
import type { LeaveManagementEntry } from "../hr-payroll/leave-management-utils";
import type { LoanRegisterEntry } from "../hr-payroll/loan-register-utils";
import type { PayrollProcessingRow } from "../hr-payroll/payroll-processing-utils";
import {
  formatPeriodLabel,
  getPeriodStartDate,
  isDateInPayrollMonth,
  isMonthClosed,
  type MonthEndCloseRecord,
} from "../hr-payroll/payroll-period-utils";
import { formatReportPeriodLabel } from "./finance-reports-utils";

export type HrReportEmployee = HrEmployee & {
  position?: string | null;
};

export type PayrollSummaryRow = {
  staffId: string;
  fullName: string;
  basicSalary: number;
  grossPay: number;
  employeeSsnit: number;
  payeTax: number;
  loanRepayment: number;
  totalDeductions: number;
  netPay: number;
  employerSsnitCost: number;
};

export type PayrollSummaryTotals = {
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  employerSsnitCost: number;
};

export type PayrollSummaryReport = {
  periodLabel: string;
  isDraft: boolean;
  rows: PayrollSummaryRow[];
  totals: PayrollSummaryTotals;
};

export type AttendanceSummaryRow = {
  staffId: string;
  fullName: string;
  present: number;
  absent: number;
  late: number;
  onLeave: number;
  offDuty: number;
  totalDaysRecorded: number;
};

export type LeaveBalanceRow = {
  staffId: string;
  fullName: string;
  leaveType: string;
  daysRequested: number;
  daysApproved: number | null;
  approvalStatus: string;
  leaveBalanceRemaining: number | null;
};

export type LoanRegisterSummaryRow = {
  staffId: string;
  fullName: string;
  loanAmount: number;
  dateIssued: string;
  monthlyDeduction: number;
  totalRepaidToDate: number;
  outstandingBalance: number;
  status: "Active" | "Fully Repaid";
};

export type OvertimeSummaryRow = {
  staffId: string;
  fullName: string;
  totalOvertimeHours: number;
  totalOvertimeAmount: number;
};

export type HeadcountSummary = {
  totalActive: number;
  totalCasual: number;
  totalPartTime: number;
  totalFullTime: number;
  totalInactiveTerminated: number;
};

export type ContractExpiryRow = {
  staffId: string;
  fullName: string;
  position: string;
  appointmentEndDate: string;
  daysUntilOrPastExpiry: number;
  isPastExpiryWhileActive: boolean;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeStatus(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function getEmployeeMap(
  employees: HrReportEmployee[],
): Map<string, HrReportEmployee> {
  return new Map(employees.map((employee) => [employee.employee_id, employee]));
}

export function buildAvailableHrReportYears(
  ...dateLists: string[][]
): number[] {
  const years = new Set<number>();

  for (const dates of dateLists) {
    for (const date of dates) {
      const year = Number(date.slice(0, 4));
      if (Number.isFinite(year) && year > 0) {
        years.add(year);
      }
    }
  }

  const currentYear = new Date().getFullYear();
  years.add(currentYear);

  return [...years].sort((left, right) => right - left);
}

export function resolvePayrollSummarySource(
  year: number,
  month: number,
  monthEndCloseRecords: MonthEndCloseRecord[],
  payrollHistory: PayrollProcessingRow[],
  payrollProcessing: PayrollProcessingRow[],
): { rows: PayrollProcessingRow[]; isDraft: boolean } {
  const payrollMonth = getPeriodStartDate(year, month);
  const closeRecord =
    monthEndCloseRecords.find(
      (record) => record.month.slice(0, 10) === payrollMonth,
    ) ?? null;

  if (isMonthClosed(closeRecord)) {
    return {
      rows: payrollHistory.filter(
        (row) => row.payroll_month.slice(0, 10) === payrollMonth,
      ),
      isDraft: false,
    };
  }

  return {
    rows: payrollProcessing.filter(
      (row) => row.payroll_month.slice(0, 10) === payrollMonth,
    ),
    isDraft: true,
  };
}

export function buildMonthlyPayrollSummaryReport(
  year: number,
  month: number,
  employees: HrReportEmployee[],
  monthEndCloseRecords: MonthEndCloseRecord[],
  payrollHistory: PayrollProcessingRow[],
  payrollProcessing: PayrollProcessingRow[],
): PayrollSummaryReport {
  const { rows: payrollRows, isDraft } = resolvePayrollSummarySource(
    year,
    month,
    monthEndCloseRecords,
    payrollHistory,
    payrollProcessing,
  );
  const employeeMap = getEmployeeMap(employees);

  const rows = payrollRows
    .map((row) => {
      const employee = employeeMap.get(row.employee_id);
      const employerSsnitCost = roundMoney(
        (Number(row.employer_ssnit) || 0) + (Number(row.tier2) || 0),
      );

      return {
        staffId: employee?.staff_id ?? row.employee_id,
        fullName: employee?.full_name ?? row.employee_id,
        basicSalary: roundMoney(Number(row.basic_salary) || 0),
        grossPay: roundMoney(Number(row.gross_pay) || 0),
        employeeSsnit: roundMoney(Number(row.employee_ssnit) || 0),
        payeTax: roundMoney(Number(row.paye_tax) || 0),
        loanRepayment: roundMoney(Number(row.loan_repayment) || 0),
        totalDeductions: roundMoney(Number(row.total_deductions) || 0),
        netPay: roundMoney(Number(row.net_pay) || 0),
        employerSsnitCost,
      };
    })
    .sort((left, right) => left.staffId.localeCompare(right.staffId));

  const totals = rows.reduce<PayrollSummaryTotals>(
    (accumulator, row) => ({
      grossPay: roundMoney(accumulator.grossPay + row.grossPay),
      totalDeductions: roundMoney(
        accumulator.totalDeductions + row.totalDeductions,
      ),
      netPay: roundMoney(accumulator.netPay + row.netPay),
      employerSsnitCost: roundMoney(
        accumulator.employerSsnitCost + row.employerSsnitCost,
      ),
    }),
    {
      grossPay: 0,
      totalDeductions: 0,
      netPay: 0,
      employerSsnitCost: 0,
    },
  );

  return {
    periodLabel: formatReportPeriodLabel(year, month),
    isDraft,
    rows,
    totals,
  };
}

function countAttendanceStatus(
  status: string,
): keyof Omit<
  AttendanceSummaryRow,
  "staffId" | "fullName" | "totalDaysRecorded"
> | null {
  const normalized = normalizeStatus(status);

  if (normalized === "present") return "present";
  if (normalized === "absent") return "absent";
  if (normalized === "late") return "late";
  if (normalized === "on leave") return "onLeave";
  if (normalized === "off duty") return "offDuty";

  return null;
}

export function buildAttendanceSummaryReport(
  year: number,
  month: number,
  employees: HrReportEmployee[],
  attendanceEntries: Array<{ staff_id: string; date: string; attendance_status: string }>,
): AttendanceSummaryRow[] {
  const periodEmployees = employees.filter((employee) =>
    wasEmployedDuringPayrollPeriod(
      {
        date_hired: employee.date_hired ?? null,
        appointment_end_date: employee.appointment_end_date ?? null,
      },
      year,
      month,
    ),
  );

  return periodEmployees
    .map((employee) => {
      const counts = {
        present: 0,
        absent: 0,
        late: 0,
        onLeave: 0,
        offDuty: 0,
      };

      for (const entry of attendanceEntries) {
        if (entry.staff_id !== employee.staff_id) {
          continue;
        }

        if (!isDateInPayrollMonth(entry.date, year, month)) {
          continue;
        }

        const bucket = countAttendanceStatus(entry.attendance_status);
        if (bucket) {
          counts[bucket] += 1;
        }
      }

      const totalDaysRecorded =
        counts.present +
        counts.absent +
        counts.late +
        counts.onLeave +
        counts.offDuty;

      return {
        staffId: employee.staff_id,
        fullName: employee.full_name,
        ...counts,
        totalDaysRecorded,
      };
    })
    .sort((left, right) => left.staffId.localeCompare(right.staffId));
}

export function buildLeaveBalanceReport(
  employees: HrReportEmployee[],
  leaveEntries: LeaveManagementEntry[],
  approvalStatusFilter: string,
): LeaveBalanceRow[] {
  const employeeMap = getEmployeeMap(employees);
  const normalizedFilter = normalizeStatus(approvalStatusFilter);

  return leaveEntries
    .filter((entry) => {
      if (!normalizedFilter || normalizedFilter === "all") {
        return true;
      }

      return normalizeStatus(entry.approval_status) === normalizedFilter;
    })
    .map((entry) => {
      const employee = employeeMap.get(entry.employee_id);

      return {
        staffId: employee?.staff_id ?? entry.employee_id,
        fullName: employee?.full_name ?? entry.employee_id,
        leaveType: entry.leave_type,
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
      };
    })
    .sort((left, right) => {
      const staffCompare = left.staffId.localeCompare(right.staffId);
      if (staffCompare !== 0) {
        return staffCompare;
      }

      return left.leaveType.localeCompare(right.leaveType);
    });
}

export function buildLoanRegisterSummaryReport(
  employees: HrReportEmployee[],
  loans: LoanRegisterEntry[],
): { rows: LoanRegisterSummaryRow[]; totalOutstandingBalance: number } {
  const employeeMap = getEmployeeMap(employees);

  const rows = loans
    .map((loan) => {
      const employee = employeeMap.get(loan.employee_id);
      const totalRepaid = Number(loan.total_repaid_to_date) || 0;
      const outstandingBalance =
        loan.outstanding_balance === null ||
        loan.outstanding_balance === undefined
          ? calculateLoanOutstanding(loan.loan_amount, totalRepaid)
          : Number(loan.outstanding_balance) || 0;

      return {
        staffId: employee?.staff_id ?? loan.employee_id,
        fullName: employee?.full_name ?? loan.employee_id,
        loanAmount: roundMoney(Number(loan.loan_amount) || 0),
        dateIssued: loan.date_issued,
        monthlyDeduction: roundMoney(Number(loan.monthly_deduction) || 0),
        totalRepaidToDate: roundMoney(totalRepaid),
        outstandingBalance: roundMoney(outstandingBalance),
        status: getLoanStatus(outstandingBalance),
      };
    })
    .sort((left, right) => left.staffId.localeCompare(right.staffId));

  const totalOutstandingBalance = roundMoney(
    rows.reduce((sum, row) => sum + row.outstandingBalance, 0),
  );

  return { rows, totalOutstandingBalance };
}

export function buildOvertimeSummaryReport(
  year: number,
  month: number,
  employees: HrReportEmployee[],
  overtimeEntries: Array<{
    employee_id: string;
    date: string;
    overtime_hours: number | null;
    overtime_amount: number | null;
  }>,
): { rows: OvertimeSummaryRow[]; totalOvertimeAmount: number } {
  const employeeMap = getEmployeeMap(employees);
  const totalsByEmployee = new Map<
    string,
    { hours: number; amount: number }
  >();

  for (const entry of overtimeEntries) {
    if (!isDateInPayrollMonth(entry.date, year, month)) {
      continue;
    }

    const current = totalsByEmployee.get(entry.employee_id) ?? {
      hours: 0,
      amount: 0,
    };

    current.hours += Number(entry.overtime_hours) || 0;
    current.amount += Number(entry.overtime_amount) || 0;
    totalsByEmployee.set(entry.employee_id, current);
  }

  const rows = [...totalsByEmployee.entries()]
    .map(([employeeId, totals]) => {
      const employee = employeeMap.get(employeeId);

      return {
        staffId: employee?.staff_id ?? employeeId,
        fullName: employee?.full_name ?? employeeId,
        totalOvertimeHours: roundMoney(totals.hours),
        totalOvertimeAmount: roundMoney(totals.amount),
      };
    })
    .sort((left, right) => left.staffId.localeCompare(right.staffId));

  const totalOvertimeAmount = roundMoney(
    rows.reduce((sum, row) => sum + row.totalOvertimeAmount, 0),
  );

  return { rows, totalOvertimeAmount };
}

function normalizeEmploymentType(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function buildHeadcountSummary(
  employees: HrReportEmployee[],
): HeadcountSummary {
  let totalActive = 0;
  let totalCasual = 0;
  let totalPartTime = 0;
  let totalFullTime = 0;
  let totalInactiveTerminated = 0;

  for (const employee of employees) {
    if (isActiveEmployee(employee)) {
      totalActive += 1;
      const employmentType = normalizeEmploymentType(employee.employment_type);

      if (employmentType === "Casual") {
        totalCasual += 1;
      } else if (employmentType === "Part-Time") {
        totalPartTime += 1;
      } else if (employmentType === "Full-Time") {
        totalFullTime += 1;
      }
    } else {
      totalInactiveTerminated += 1;
    }
  }

  return {
    totalActive,
    totalCasual,
    totalPartTime,
    totalFullTime,
    totalInactiveTerminated,
  };
}

export function buildContractExpiryReport(
  employees: HrReportEmployee[],
  referenceDate = new Date(),
): ContractExpiryRow[] {
  const today = referenceDate.toISOString().slice(0, 10);
  const horizon = new Date(referenceDate);
  horizon.setDate(horizon.getDate() + 30);
  const horizonDate = horizon.toISOString().slice(0, 10);

  return employees
    .filter((employee) => {
      const appointmentEnd = employee.appointment_end_date?.slice(0, 10);
      if (!appointmentEnd) {
        return false;
      }

      const withinHorizon = appointmentEnd <= horizonDate;
      const pastWhileActive =
        appointmentEnd < today && isActiveEmployee(employee);

      return withinHorizon || pastWhileActive;
    })
    .map((employee) => {
      const appointmentEndDate = employee.appointment_end_date!.slice(0, 10);
      const end = new Date(`${appointmentEndDate}T12:00:00`);
      const start = new Date(`${today}T12:00:00`);
      const diffMs = end.getTime() - start.getTime();
      const daysUntilOrPastExpiry = Math.round(diffMs / (1000 * 60 * 60 * 24));

      return {
        staffId: employee.staff_id,
        fullName: employee.full_name,
        position: employee.position?.trim() || "—",
        appointmentEndDate,
        daysUntilOrPastExpiry,
        isPastExpiryWhileActive:
          appointmentEndDate < today && isActiveEmployee(employee),
      };
    })
    .sort((left, right) =>
      left.appointmentEndDate.localeCompare(right.appointmentEndDate),
    );
}

export function formatHeadcountPeriodLabel(referenceDate = new Date()): string {
  return `As at ${formatPeriodLabel(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
  )} (${referenceDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })})`;
}

export function formatContractExpiryLabel(days: number): string {
  if (days > 0) {
    return `${days} day${days === 1 ? "" : "s"} until expiry`;
  }

  if (days === 0) {
    return "Expires today";
  }

  const pastDays = Math.abs(days);
  return `${pastDays} day${pastDays === 1 ? "" : "s"} past expiry`;
}
