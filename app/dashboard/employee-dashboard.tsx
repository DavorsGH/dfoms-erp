"use client";

import Link from "next/link";
import {
  formatPeriodLabel,
  parsePeriodKey,
  payrollMonthToPeriodKey,
} from "./hr-payroll/payroll-period-utils";
import type { EmployeeDashboardSummary } from "./employee-dashboard-utils";

function formatPayslipMonthLabel(payrollMonth: string): string {
  const periodKey = payrollMonthToPeriodKey(payrollMonth);
  const parsed = periodKey ? parsePeriodKey(periodKey) : null;
  if (!parsed) {
    return payrollMonth;
  }
  return formatPeriodLabel(parsed.year, parsed.month);
}

type EmployeeDashboardProps = {
  summary: EmployeeDashboardSummary;
  fetchError: string | null;
};

function SummaryCard({
  title,
  value,
  subtitle,
  href,
}: {
  title: string;
  value: string;
  subtitle?: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-[#0f2744] hover:shadow-md"
    >
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {subtitle ? (
        <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
      ) : null}
      <p className="mt-2 text-2xl font-semibold text-[#0f2744]">{value}</p>
    </Link>
  );
}

export default function EmployeeDashboard({
  summary,
  fetchError,
}: EmployeeDashboardProps) {
  const payslipLabel = summary.latestPayslipMonth
    ? formatPayslipMonthLabel(summary.latestPayslipMonth)
    : "No payslip yet";

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#0f2744]">Dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">
          Welcome back, {summary.employeeName}. Here is your summary for{" "}
          {summary.periodLabel}.
        </p>
      </div>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          title="Attendance This Month"
          subtitle={`${summary.presentDays} present day${summary.presentDays === 1 ? "" : "s"} recorded`}
          value={`${summary.attendanceRecorded} entries`}
          href="/dashboard/self-service/attendance"
        />
        <SummaryCard
          title="Leave Requests"
          subtitle={
            summary.pendingLeaveRequests > 0
              ? `${summary.pendingLeaveRequests} pending approval`
              : "No pending requests"
          }
          value={
            summary.leaveBalances.length > 0
              ? `${summary.leaveBalances[0].remaining.toFixed(1)} days ${summary.leaveBalances[0].typeName}`
              : "View balances"
          }
          href="/dashboard/self-service/leave"
        />
        <SummaryCard
          title="Latest Payslip"
          subtitle="Open your payslip in Self-Service"
          value={payslipLabel}
          href="/dashboard/self-service/payslip"
        />
      </div>

      {summary.leaveBalances.length > 0 ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-[#0f2744]">Leave Balances</h2>
          <ul className="mt-4 space-y-2 text-sm text-slate-700">
            {summary.leaveBalances.map((balance) => (
              <li
                key={balance.typeName}
                className="flex items-center justify-between rounded-md bg-slate-50 px-4 py-2"
              >
                <span>{balance.typeName}</span>
                <span className="font-medium text-[#0f2744]">
                  {balance.remaining.toFixed(1)} days remaining
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
