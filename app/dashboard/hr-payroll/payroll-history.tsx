"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  compareStaffIds,
  formatGHS,
  inputClassName,
} from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  findMonthEndCloseForKey,
  formatPeriodLabel,
  getHistoryPeriodDisplayStatus,
  getPeriodSelectorLabel,
  normalizePayrollMonthValue,
  parsePeriodKey,
  payrollMonthToPeriodKey,
  type MonthEndCloseRecord,
} from "./payroll-period-utils";
import type { PayrollHistoryRow } from "./payroll-processing-utils";

type PayrollHistoryEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
};

type PayrollHistoryProps = {
  initialPayrollMonths: string[];
  initialMonthEndClose: MonthEndCloseRecord[];
  initialEmployees: PayrollHistoryEmployee[];
  fetchError: string | null;
};

type HistoryWorkspaceRow = PayrollHistoryRow & {
  staff_id: string;
  full_name: string;
};

function sortHistoryRows(rows: HistoryWorkspaceRow[]): HistoryWorkspaceRow[] {
  return [...rows].sort((left, right) =>
    compareStaffIds(left.staff_id, right.staff_id),
  );
}

function toHistoryWorkspaceRow(
  row: PayrollHistoryRow,
  employee: PayrollHistoryEmployee | undefined,
): HistoryWorkspaceRow {
  return {
    ...row,
    staff_id: employee?.staff_id ?? "—",
    full_name: employee?.full_name ?? row.employee_id,
  };
}

function escapeCsvValue(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function exportHistoryToCsv(rows: HistoryWorkspaceRow[], monthLabel: string) {
  const headers = [
    "Staff ID",
    "Full Name",
    "Days to Pay",
    "Basic Salary",
    "Absence Deduction",
    "Overtime",
    "Gross Pay",
    "Employee SSNIT",
    "PAYE Tax",
    "Loan Repayment",
    "Total Deductions",
    "Net Pay",
    "Employer SSNIT",
    "Tier 2",
  ];

  const lines = rows.map((row) =>
    [
      row.staff_id,
      row.full_name,
      row.days_to_pay ?? "",
      row.basic_salary ?? "",
      row.absence_deduction ?? "",
      row.overtime_amount ?? "",
      row.gross_pay ?? "",
      row.employee_ssnit ?? "",
      row.paye_tax ?? "",
      row.loan_repayment ?? "",
      row.total_deductions ?? "",
      row.net_pay ?? "",
      row.employer_ssnit ?? "",
      row.tier2 ?? "",
    ]
      .map(escapeCsvValue)
      .join(","),
  );

  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `payroll-history-${monthLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export default function PayrollHistory({
  initialPayrollMonths,
  initialMonthEndClose,
  initialEmployees,
  fetchError,
}: PayrollHistoryProps) {
  const supabase = createClient();
  const [monthEndCloseRows] = useState(initialMonthEndClose);
  const [monthEndClose, setMonthEndClose] = useState<MonthEndCloseRecord | null>(
    null,
  );
  const [employees] = useState(initialEmployees);
  const [payrollMonths] = useState(initialPayrollMonths);
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(
    initialPayrollMonths[0] ?? "",
  );
  const [rows, setRows] = useState<HistoryWorkspaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.employee_id, employee])),
    [employees],
  );

  const selectedPeriodKey = payrollMonthToPeriodKey(selectedPayrollMonth) ?? "";
  const selectedParsed = parsePeriodKey(selectedPeriodKey);

  const periodStatus = getHistoryPeriodDisplayStatus(monthEndClose);
  const periodLabel = selectedParsed
    ? formatPeriodLabel(selectedParsed.year, selectedParsed.month)
    : "—";

  const periodOptions = useMemo(() => {
    return payrollMonths
      .map((payrollMonth) => {
        const key = payrollMonthToPeriodKey(payrollMonth);
        if (!key) {
          return null;
        }

        const parsed = parsePeriodKey(key);
        if (!parsed) {
          return null;
        }

        const closeRecord = findMonthEndCloseForKey(monthEndCloseRows, key);

        return {
          value: normalizePayrollMonthValue(payrollMonth),
          label: getPeriodSelectorLabel(
            parsed.year,
            parsed.month,
            closeRecord ?? null,
          ),
        };
      })
      .filter(
        (option): option is { value: string; label: string } => option !== null,
      );
  }, [payrollMonths, monthEndCloseRows]);

  const totals = useMemo(() => {
    return rows.reduce(
      (accumulator, row) => ({
        grossPay: accumulator.grossPay + (Number(row.gross_pay) || 0),
        totalDeductions:
          accumulator.totalDeductions + (Number(row.total_deductions) || 0),
        netPay: accumulator.netPay + (Number(row.net_pay) || 0),
        employeeSsnit:
          accumulator.employeeSsnit + (Number(row.employee_ssnit) || 0),
        employerSsnit:
          accumulator.employerSsnit + (Number(row.employer_ssnit) || 0),
        tier2: accumulator.tier2 + (Number(row.tier2) || 0),
        payeTax: accumulator.payeTax + (Number(row.paye_tax) || 0),
        employerSsnitCost:
          accumulator.employerSsnitCost +
          (Number(row.employer_ssnit) || 0) +
          (Number(row.tier2) || 0),
      }),
      {
        grossPay: 0,
        totalDeductions: 0,
        netPay: 0,
        employeeSsnit: 0,
        employerSsnit: 0,
        tier2: 0,
        payeTax: 0,
        employerSsnitCost: 0,
      },
    );
  }, [rows]);

  useEffect(() => {
    if (!selectedPayrollMonth) {
      setRows([]);
      return;
    }

    void loadHistory(selectedPayrollMonth);
  }, [selectedPayrollMonth]);

  async function loadHistory(payrollMonth: string) {
    setLoading(true);
    setError(null);

    try {
      const { data: closeRecord, error: closeError } = await supabase
        .from("month_end_close")
        .select("*")
        .eq("month", payrollMonth)
        .maybeSingle();

      if (closeError) {
        throw new Error(closeError.message);
      }

      setMonthEndClose((closeRecord as MonthEndCloseRecord | null) ?? null);

      const { data, error: historyError } = await supabase
        .from("payroll_history")
        .select("*")
        .eq("payroll_month", payrollMonth)
        .order("employee_id", { ascending: true });

      if (historyError) {
        throw new Error(historyError.message);
      }

      setRows(
        sortHistoryRows(
          ((data as PayrollHistoryRow[] | null) ?? []).map((row) =>
            toHistoryWorkspaceRow(row, employeeMap.get(row.employee_id)),
          ),
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load payroll history.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-[280px]">
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Payroll Period
          </label>
          <select
            value={selectedPayrollMonth}
            onChange={(event) => setSelectedPayrollMonth(event.target.value)}
            className={inputClassName}
            disabled={loading || periodOptions.length === 0}
          >
            {periodOptions.length === 0 ? (
              <option value="">No locked payroll history</option>
            ) : (
              periodOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            )}
          </select>
        </div>

        {rows.length > 0 ? (
          <button
            type="button"
            onClick={() => exportHistoryToCsv(rows, periodLabel)}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Export to CSV
          </button>
        ) : null}
      </div>

      {selectedPayrollMonth ? (
        <p className="text-sm text-slate-600">
          Period:{" "}
          <span className="font-medium text-[#0f2744]">{periodLabel}</span>
          {" · "}
          Status:{" "}
          <span className="font-medium text-[#0f2744]">{periodStatus}</span>
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
            GRA / SSNIT Filing Summary
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <p className="text-sm text-slate-600">
              Employee SSNIT:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.employeeSsnit)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Employer SSNIT:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.employerSsnit)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Employer SSNIT Tier 2:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.tier2)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              PAYE Tax:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.payeTax)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Total Employer SSNIT Cost:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.employerSsnitCost)}
              </span>
            </p>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-600">Loading payroll history…</p>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Staff ID</th>
              <th className={scrollableTableThClassName}>Full Name</th>
              <th className={scrollableTableThClassName}>Days to Pay</th>
              <th className={scrollableTableThClassName}>Basic Salary</th>
              <th className={scrollableTableThClassName}>Absence Deduction</th>
              <th className={scrollableTableThClassName}>Overtime</th>
              <th className={scrollableTableThClassName}>Gross Pay</th>
              <th className={scrollableTableThClassName}>Employee SSNIT</th>
              <th className={scrollableTableThClassName}>PAYE Tax</th>
              <th className={scrollableTableThClassName}>Loan Repayment</th>
              <th className={scrollableTableThClassName}>Total Deductions</th>
              <th className={scrollableTableThClassName}>Net Pay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                  {periodOptions.length === 0
                    ? "No locked payroll history records yet."
                    : "No payroll history rows for this period."}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="text-slate-700">
                  <td className="px-4 py-3">{row.staff_id}</td>
                  <td className="px-4 py-3">{row.full_name}</td>
                  <td className="px-4 py-3">{row.days_to_pay ?? "—"}</td>
                  <td className="px-4 py-3">{formatGHS(row.basic_salary)}</td>
                  <td className="px-4 py-3">
                    {formatGHS(row.absence_deduction)}
                  </td>
                  <td className="px-4 py-3">{formatGHS(row.overtime_amount)}</td>
                  <td className="px-4 py-3">{formatGHS(row.gross_pay)}</td>
                  <td className="px-4 py-3">{formatGHS(row.employee_ssnit)}</td>
                  <td className="px-4 py-3">{formatGHS(row.paye_tax)}</td>
                  <td className="px-4 py-3">{formatGHS(row.loan_repayment)}</td>
                  <td className="px-4 py-3">{formatGHS(row.total_deductions)}</td>
                  <td className="px-4 py-3">{formatGHS(row.net_pay)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {rows.length > 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
            Period Totals
          </h3>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <p className="text-sm text-slate-600">
              Total Gross:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.grossPay)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Total Deductions:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.totalDeductions)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Total Net Pay:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.netPay)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Total Employer SSNIT Cost:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(totals.employerSsnitCost)}
              </span>
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
