"use client";

import { useMemo, useState } from "react";
import { getStripedRowClassName } from "../finance/register-row-actions";
import { inputClassName } from "../employees/employee-record-utils";
import type { LeaveManagementEntry } from "../hr-payroll/leave-management-utils";
import { APPROVAL_STATUS_OPTIONS } from "../hr-payroll/leave-management-utils";
import type { LoanRegisterEntry } from "../hr-payroll/loan-register-utils";
import type { PayrollProcessingRow } from "../hr-payroll/payroll-processing-utils";
import type { MonthEndCloseRecord } from "../hr-payroll/payroll-period-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatReportPeriodLabel,
  getDefaultReportMonthYear,
} from "./finance-reports-utils";
import {
  buildAttendanceSummaryReport,
  buildContractExpiryReport,
  buildHeadcountSummary,
  buildLeaveBalanceReport,
  buildLoanRegisterSummaryReport,
  buildMonthlyPayrollSummaryReport,
  buildOvertimeSummaryReport,
  formatContractExpiryLabel,
  formatHeadcountPeriodLabel,
  type HrReportEmployee,
} from "./hr-reports-utils";
import {
  FINANCE_REPORT_PRINT_AREA_ID,
  ReportActionBar,
  ReportCompanyHeader,
  ReportMonthYearSelector,
  ReportPrintStyles,
  downloadCsv,
  formatReportCurrency,
  formatReportDate,
} from "./report-ui";

type FetchErrorProps = {
  fetchError: string | null;
};

function ReportFetchError({ fetchError }: FetchErrorProps) {
  if (!fetchError) {
    return null;
  }

  return (
    <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {fetchError}
    </p>
  );
}

function useMonthYearSelection(availableYears: number[]) {
  const defaults = getDefaultReportMonthYear();
  const [year, setYear] = useState(
    availableYears.includes(defaults.year)
      ? defaults.year
      : (availableYears[0] ?? defaults.year),
  );
  const [month, setMonth] = useState(defaults.month);
  const periodLabel = formatReportPeriodLabel(year, month);

  return {
    year,
    month,
    setYear,
    setMonth,
    periodLabel,
  };
}

function handleReportPrint() {
  window.print();
}

function ReportPanel({
  title,
  periodLabel,
  children,
}: {
  title: string;
  periodLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div
      id={FINANCE_REPORT_PRINT_AREA_ID}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
    >
      <ReportCompanyHeader title={title} periodLabel={periodLabel} />
      {children}
    </div>
  );
}

function DraftBanner() {
  return (
    <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
      DRAFT — This period is not yet locked. Figures are taken from open
      Payroll Processing and may change before lock.
    </div>
  );
}

export function MonthlyPayrollSummaryReport({
  initialEmployees,
  initialPayrollHistory,
  initialPayrollProcessing,
  initialMonthEndCloseRecords,
  availableYears,
  fetchError,
}: {
  initialEmployees: HrReportEmployee[];
  initialPayrollHistory: PayrollProcessingRow[];
  initialPayrollProcessing: PayrollProcessingRow[];
  initialMonthEndCloseRecords: MonthEndCloseRecord[];
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);

  const report = useMemo(
    () =>
      buildMonthlyPayrollSummaryReport(
        year,
        month,
        initialEmployees,
        initialMonthEndCloseRecords,
        initialPayrollHistory,
        initialPayrollProcessing,
      ),
    [
      year,
      month,
      initialEmployees,
      initialMonthEndCloseRecords,
      initialPayrollHistory,
      initialPayrollProcessing,
    ],
  );

  function exportCsv() {
    downloadCsv(
      `monthly-payroll-summary-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        "Staff ID",
        "Full Name",
        "Basic Salary",
        "Gross Pay",
        "Employee SSNIT",
        "PAYE Tax",
        "Loan Repayment",
        "Total Deductions",
        "Net Pay",
        "Employer SSNIT Cost",
      ],
      report.rows.map((row) => [
        row.staffId,
        row.fullName,
        row.basicSalary,
        row.grossPay,
        row.employeeSsnit,
        row.payeTax,
        row.loanRepayment,
        row.totalDeductions,
        row.netPay,
        row.employerSsnitCost,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Monthly Payroll Summary" periodLabel={periodLabel}>
        {report.isDraft && <DraftBanner />}
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>Full Name</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Basic Salary
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Gross Pay
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Employee SSNIT
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  PAYE Tax
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Loan Repayment
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Total Deductions
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Net Pay
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No payroll rows for this period.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={row.staffId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.staffId}</td>
                    <td className="px-4 py-3">{row.fullName}</td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.basicSalary)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.grossPay)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.employeeSsnit)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.payeTax)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.loanRepayment)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.totalDeductions)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.netPay)}
                    </td>
                  </tr>
                ))
              )}
              {report.rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={2}>
                    Company Totals
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right">
                    {formatReportCurrency(report.totals.grossPay)}
                  </td>
                  <td className="px-4 py-3" colSpan={3} />
                  <td className="px-4 py-3 text-right">
                    {formatReportCurrency(report.totals.totalDeductions)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatReportCurrency(report.totals.netPay)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
        {report.rows.length > 0 && (
          <p className="mt-4 text-sm font-medium text-[#0f2744]">
            Total Employer SSNIT Cost:{" "}
            {formatReportCurrency(report.totals.employerSsnitCost)}
          </p>
        )}
      </ReportPanel>
    </div>
  );
}

export function AttendanceSummaryReport({
  initialEmployees,
  initialAttendanceEntries,
  availableYears,
  fetchError,
}: {
  initialEmployees: HrReportEmployee[];
  initialAttendanceEntries: Array<{
    staff_id: string;
    date: string;
    attendance_status: string;
  }>;
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);

  const rows = useMemo(
    () =>
      buildAttendanceSummaryReport(
        year,
        month,
        initialEmployees,
        initialAttendanceEntries,
      ),
    [year, month, initialEmployees, initialAttendanceEntries],
  );

  function exportCsv() {
    downloadCsv(
      `attendance-summary-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        "Staff ID",
        "Full Name",
        "Present",
        "Absent",
        "Late",
        "On Leave",
        "Off Duty",
        "Total Days Recorded",
      ],
      rows.map((row) => [
        row.staffId,
        row.fullName,
        row.present,
        row.absent,
        row.late,
        row.onLeave,
        row.offDuty,
        row.totalDaysRecorded,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={rows.length === 0}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Attendance Summary" periodLabel={periodLabel}>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>Full Name</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Present
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Absent
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Late
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  On Leave
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Off Duty
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Total Days Recorded
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No employees in scope for this period.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.staffId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.staffId}</td>
                    <td className="px-4 py-3">{row.fullName}</td>
                    <td className="px-4 py-3 text-right">{row.present}</td>
                    <td className="px-4 py-3 text-right">{row.absent}</td>
                    <td className="px-4 py-3 text-right">{row.late}</td>
                    <td className="px-4 py-3 text-right">{row.onLeave}</td>
                    <td className="px-4 py-3 text-right">{row.offDuty}</td>
                    <td className="px-4 py-3 text-right">
                      {row.totalDaysRecorded}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function LeaveBalanceReport({
  initialEmployees,
  initialLeaveEntries,
  fetchError,
}: {
  initialEmployees: HrReportEmployee[];
  initialLeaveEntries: LeaveManagementEntry[];
  fetchError: string | null;
}) {
  const [approvalStatusFilter, setApprovalStatusFilter] = useState("all");
  const periodLabel = "All leave records";

  const rows = useMemo(
    () =>
      buildLeaveBalanceReport(
        initialEmployees,
        initialLeaveEntries,
        approvalStatusFilter,
      ),
    [initialEmployees, initialLeaveEntries, approvalStatusFilter],
  );

  function exportCsv() {
    downloadCsv(
      "leave-balance-report.csv",
      [
        "Staff ID",
        "Full Name",
        "Leave Type",
        "Days Requested",
        "Days Approved",
        "Approval Status",
        "Leave Balance Remaining",
      ],
      rows.map((row) => [
        row.staffId,
        row.fullName,
        row.leaveType,
        row.daysRequested,
        row.daysApproved,
        row.approvalStatus,
        row.leaveBalanceRemaining,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={rows.length === 0}
      >
        <div className="min-w-[180px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Approval Status
          </label>
          <select
            value={approvalStatusFilter}
            onChange={(event) => setApprovalStatusFilter(event.target.value)}
            className={inputClassName}
          >
            <option value="all">All</option>
            {APPROVAL_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Leave Balance Report" periodLabel={periodLabel}>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>Full Name</th>
                <th className={scrollableTableThClassName}>Leave Type</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Days Requested
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Days Approved
                </th>
                <th className={scrollableTableThClassName}>Approval Status</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Leave Balance Remaining
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No leave records match the selected filter.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr
                    key={`${row.staffId}-${row.leaveType}-${index}`}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3">{row.staffId}</td>
                    <td className="px-4 py-3">{row.fullName}</td>
                    <td className="px-4 py-3">{row.leaveType}</td>
                    <td className="px-4 py-3 text-right">
                      {row.daysRequested}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {row.daysApproved ?? "—"}
                    </td>
                    <td className="px-4 py-3">{row.approvalStatus}</td>
                    <td className="px-4 py-3 text-right">
                      {row.leaveBalanceRemaining ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function LoanRegisterSummaryReport({
  initialEmployees,
  initialLoans,
  fetchError,
}: {
  initialEmployees: HrReportEmployee[];
  initialLoans: LoanRegisterEntry[];
  fetchError: string | null;
}) {
  const periodLabel = "All loans";

  const report = useMemo(
    () => buildLoanRegisterSummaryReport(initialEmployees, initialLoans),
    [initialEmployees, initialLoans],
  );

  function exportCsv() {
    downloadCsv(
      "loan-register-summary.csv",
      [
        "Staff ID",
        "Full Name",
        "Loan Amount",
        "Date Issued",
        "Monthly Deduction",
        "Total Repaid to Date",
        "Outstanding Balance",
        "Status",
      ],
      report.rows.map((row) => [
        row.staffId,
        row.fullName,
        row.loanAmount,
        row.dateIssued,
        row.monthlyDeduction,
        row.totalRepaidToDate,
        row.outstandingBalance,
        row.status,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      />
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Loan Register Summary" periodLabel={periodLabel}>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>Full Name</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Loan Amount
                </th>
                <th className={scrollableTableThClassName}>Date Issued</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Monthly Deduction
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Total Repaid to Date
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Outstanding Balance
                </th>
                <th className={scrollableTableThClassName}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No loan records found.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={`${row.staffId}-${row.dateIssued}-${index}`} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.staffId}</td>
                    <td className="px-4 py-3">{row.fullName}</td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.loanAmount)}
                    </td>
                    <td className="px-4 py-3">
                      {formatReportDate(row.dateIssued)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.monthlyDeduction)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.totalRepaidToDate)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.outstandingBalance)}
                    </td>
                    <td className="px-4 py-3">{row.status}</td>
                  </tr>
                ))
              )}
              {report.rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={6}>
                    Total Outstanding Balance
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatReportCurrency(report.totalOutstandingBalance)}
                  </td>
                  <td className="px-4 py-3" />
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function OvertimeSummaryReport({
  initialEmployees,
  initialOvertimeEntries,
  availableYears,
  fetchError,
}: {
  initialEmployees: HrReportEmployee[];
  initialOvertimeEntries: Array<{
    employee_id: string;
    date: string;
    overtime_hours: number | null;
    overtime_amount: number | null;
  }>;
  availableYears: number[];
  fetchError: string | null;
}) {
  const { year, month, setYear, setMonth, periodLabel } =
    useMonthYearSelection(availableYears);

  const report = useMemo(
    () =>
      buildOvertimeSummaryReport(
        year,
        month,
        initialEmployees,
        initialOvertimeEntries,
      ),
    [year, month, initialEmployees, initialOvertimeEntries],
  );

  function exportCsv() {
    downloadCsv(
      `overtime-summary-${year}-${String(month).padStart(2, "0")}.csv`,
      [
        "Staff ID",
        "Full Name",
        "Total Overtime Hours",
        "Total Overtime Amount",
      ],
      report.rows.map((row) => [
        row.staffId,
        row.fullName,
        row.totalOvertimeHours,
        row.totalOvertimeAmount,
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={report.rows.length === 0}
      >
        <ReportMonthYearSelector
          year={year}
          month={month}
          availableYears={availableYears}
          onYearChange={setYear}
          onMonthChange={setMonth}
        />
      </ReportActionBar>
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel title="Overtime Summary" periodLabel={periodLabel}>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>Full Name</th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Total Overtime Hours
                </th>
                <th className={`${scrollableTableThClassName} text-right`}>
                  Total Overtime Amount
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {report.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No overtime entries for this period.
                  </td>
                </tr>
              ) : (
                report.rows.map((row, index) => (
                  <tr key={row.staffId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.staffId}</td>
                    <td className="px-4 py-3">{row.fullName}</td>
                    <td className="px-4 py-3 text-right">
                      {row.totalOvertimeHours.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {formatReportCurrency(row.totalOvertimeAmount)}
                    </td>
                  </tr>
                ))
              )}
              {report.rows.length > 0 && (
                <tr className="bg-slate-50 font-semibold text-[#0f2744]">
                  <td className="px-4 py-3" colSpan={2}>
                    Company Total
                  </td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-right">
                    {formatReportCurrency(report.totalOvertimeAmount)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}

export function HeadcountContractExpiryReport({
  initialEmployees,
  fetchError,
}: {
  initialEmployees: HrReportEmployee[];
  fetchError: string | null;
}) {
  const periodLabel = formatHeadcountPeriodLabel();

  const summary = useMemo(
    () => buildHeadcountSummary(initialEmployees),
    [initialEmployees],
  );

  const contractRows = useMemo(
    () => buildContractExpiryReport(initialEmployees),
    [initialEmployees],
  );

  function exportCsv() {
    downloadCsv(
      "headcount-contract-expiry.csv",
      [
        "Staff ID",
        "Full Name",
        "Position",
        "Appointment End Date",
        "Days Until/Past Expiry",
        "Past Expiry While Active",
      ],
      contractRows.map((row) => [
        row.staffId,
        row.fullName,
        row.position,
        row.appointmentEndDate,
        row.daysUntilOrPastExpiry,
        row.isPastExpiryWhileActive ? "Yes" : "No",
      ]),
    );
  }

  const summaryCards = [
    { label: "Total Active", value: summary.totalActive },
    { label: "Total Casual", value: summary.totalCasual },
    { label: "Total Part-Time", value: summary.totalPartTime },
    { label: "Total Full-Time", value: summary.totalFullTime },
    {
      label: "Total Inactive / Terminated",
      value: summary.totalInactiveTerminated,
    },
  ];

  return (
    <div className="space-y-6">
      <ReportPrintStyles />
      <ReportActionBar
        onPrint={handleReportPrint}
        onExportCsv={exportCsv}
        exportDisabled={contractRows.length === 0}
      />
      <ReportFetchError fetchError={fetchError} />
      <ReportPanel
        title="Headcount & Contract Expiry Report"
        periodLabel={periodLabel}
      >
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-lg border border-slate-200 bg-slate-50 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {card.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
                {card.value}
              </p>
            </div>
          ))}
        </div>
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Contract Expiry Watchlist
        </h3>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Staff ID</th>
                <th className={scrollableTableThClassName}>Full Name</th>
                <th className={scrollableTableThClassName}>Position</th>
                <th className={scrollableTableThClassName}>
                  Appointment End Date
                </th>
                <th className={scrollableTableThClassName}>
                  Days Until / Past Expiry
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {contractRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-8 text-center text-slate-500"
                  >
                    No contracts expiring within the next 30 days.
                  </td>
                </tr>
              ) : (
                contractRows.map((row, index) => (
                  <tr key={row.staffId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{row.staffId}</td>
                    <td className="px-4 py-3">{row.fullName}</td>
                    <td className="px-4 py-3">{row.position}</td>
                    <td className="px-4 py-3">
                      {formatReportDate(row.appointmentEndDate)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          row.isPastExpiryWhileActive
                            ? "font-medium text-red-700"
                            : undefined
                        }
                      >
                        {formatContractExpiryLabel(row.daysUntilOrPastExpiry)}
                        {row.isPastExpiryWhileActive
                          ? " — Active status flag"
                          : ""}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </ReportPanel>
    </div>
  );
}
