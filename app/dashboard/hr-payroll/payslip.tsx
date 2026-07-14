"use client";

import { LoadingState } from "@/components/loading-indicator";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  compareStaffIds,
  formatGHS,
  inputClassName,
  type EmployeeRecord,
} from "../employees/employee-record-utils";
import {
  getDepartmentName,
  getPositionName,
  type PositionLookup,
} from "../employees/lookup-utils";
import {
  formatPeriodLabel,
  parsePeriodKey,
  payrollMonthToPeriodKey,
  resolveSelectedPeriod,
} from "./payroll-period-utils";
import type { PayrollHistoryRow } from "./payroll-processing-utils";

type PayslipEmployeeOption = {
  employee_id: string;
  staff_id: string;
  full_name: string;
};

type PayslipEmployeeDetails = Pick<
  EmployeeRecord,
  | "employee_id"
  | "staff_id"
  | "full_name"
  | "position"
  | "employment_type"
  | "bank_name"
  | "account_number"
  | "momo_number"
  | "department"
> & {
  department_ref?: EmployeeRecord["department_ref"];
};

type PayslipProps = {
  initialPayrollMonths: string[];
  positions: PositionLookup[];
  fetchError: string | null;
};

type PayslipLineItem = {
  label: string;
  amount: number;
  detail?: string;
};

const EMPLOYEE_DETAILS_SELECT =
  "employee_id, staff_id, full_name, position, employment_type, bank_name, account_number, momo_number, department, department_ref:departments!department(dept_code, department_name)";

function sortEmployeeOptions(
  employees: PayslipEmployeeOption[],
): PayslipEmployeeOption[] {
  return [...employees].sort((left, right) =>
    compareStaffIds(left.staff_id, right.staff_id),
  );
}

function formatGeneratedDate(): string {
  return new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatMonthYearLabel(payrollMonth: string): string {
  const periodKey = payrollMonthToPeriodKey(payrollMonth);
  const parsed = periodKey ? parsePeriodKey(periodKey) : null;

  if (!parsed) {
    return payrollMonth;
  }

  return formatPeriodLabel(parsed.year, parsed.month);
}

function getTotalWorkingDays(payrollMonth: string): number {
  const periodKey = payrollMonthToPeriodKey(payrollMonth);
  const parsed = periodKey ? parsePeriodKey(periodKey) : null;

  if (!parsed) {
    return 0;
  }

  return resolveSelectedPeriod(parsed.year, parsed.month).totalWorkingDays;
}

function getBasicPayLabel(
  daysToPay: number | null | undefined,
  totalWorkingDays: number,
): string {
  const days = Number(daysToPay) || 0;

  if (
    totalWorkingDays > 0 &&
    Math.abs(days - totalWorkingDays) >= 0.001 &&
    days < totalWorkingDays
  ) {
    return "Basic Pay";
  }

  return "Basic Salary";
}

function getBasicPayAmount(row: PayrollHistoryRow): number {
  const dailyRate = Number(row.daily_rate) || 0;
  const daysToPay = Number(row.days_to_pay) || 0;
  return dailyRate * daysToPay;
}

function getPaymentDetails(employee: PayslipEmployeeDetails): {
  label: string;
  value: string;
} {
  const bankName = employee.bank_name?.trim();
  const accountNumber = employee.account_number?.trim();
  const momoNumber = employee.momo_number?.trim();

  if (bankName && accountNumber) {
    return {
      label: "Bank Account",
      value: `${bankName} — ${accountNumber}`,
    };
  }

  if (bankName) {
    return { label: "Bank Account", value: bankName };
  }

  if (accountNumber) {
    return { label: "Account Number", value: accountNumber };
  }

  if (momoNumber) {
    return { label: "Mobile Money Number", value: momoNumber };
  }

  return { label: "Payment Details", value: "—" };
}

function PayslipAmountTable({
  title,
  items,
  subtotalLabel,
  subtotalAmount,
}: {
  title: string;
  items: PayslipLineItem[];
  subtotalLabel: string;
  subtotalAmount: number;
}) {
  return (
    <div className="mb-6">
      <h3 className="mb-2 border-b border-slate-300 pb-1 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
        {title}
      </h3>
      <table className="w-full text-sm">
        <tbody>
          {items.map((item) => (
            <tr key={item.label} className="border-b border-slate-100">
              <td className="py-2 pr-4 text-slate-700">
                <div>{item.label}</div>
                {item.detail ? (
                  <div className="text-xs text-slate-500">{item.detail}</div>
                ) : null}
              </td>
              <td className="py-2 text-right font-medium text-slate-900">
                {formatGHS(item.amount)}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-[#0f2744] font-semibold text-[#0f2744]">
            <td className="py-2 pr-4">{subtotalLabel}</td>
            <td className="py-2 text-right">{formatGHS(subtotalAmount)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function Payslip({
  initialPayrollMonths,
  positions,
  fetchError,
}: PayslipProps) {
  const supabase = useMemo(() => createClient(), []);

  const [selectedMonth, setSelectedMonth] = useState(
    initialPayrollMonths[0] ?? "",
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [paidEmployees, setPaidEmployees] = useState<PayslipEmployeeOption[]>(
    [],
  );
  const [payrollRow, setPayrollRow] = useState<PayrollHistoryRow | null>(null);
  const [employeeDetails, setEmployeeDetails] =
    useState<PayslipEmployeeDetails | null>(null);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingPayslip, setLoadingPayslip] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPaidEmployees = useCallback(
    async (payrollMonth: string) => {
      if (!payrollMonth) {
        setPaidEmployees([]);
        return;
      }

      setLoadingEmployees(true);
      setLoadError(null);

      const { data: historyRows, error: historyError } = await supabase
        .from("payroll_history")
        .select("employee_id")
        .eq("payroll_month", payrollMonth);

      if (historyError) {
        setLoadError(historyError.message);
        setPaidEmployees([]);
        setLoadingEmployees(false);
        return;
      }

      const employeeIds = [
        ...new Set(
          ((historyRows as { employee_id: string }[] | null) ?? []).map(
            (row) => row.employee_id,
          ),
        ),
      ];

      if (employeeIds.length === 0) {
        setPaidEmployees([]);
        setLoadingEmployees(false);
        return;
      }

      const { data: employees, error: employeesError } = await supabase
        .from("employees")
        .select("employee_id, staff_id, full_name")
        .in("employee_id", employeeIds);

      if (employeesError) {
        setLoadError(employeesError.message);
        setPaidEmployees([]);
        setLoadingEmployees(false);
        return;
      }

      setPaidEmployees(
        sortEmployeeOptions(
          (employees as PayslipEmployeeOption[] | null) ?? [],
        ),
      );
      setLoadingEmployees(false);
    },
    [supabase],
  );

  const loadPayslip = useCallback(
    async (payrollMonth: string, employeeId: string) => {
      if (!payrollMonth || !employeeId) {
        setPayrollRow(null);
        setEmployeeDetails(null);
        return;
      }

      setLoadingPayslip(true);
      setLoadError(null);

      const [
        { data: historyRow, error: historyError },
        { data: employeeRow, error: employeeError },
      ] = await Promise.all([
        supabase
          .from("payroll_history")
          .select("*")
          .eq("payroll_month", payrollMonth)
          .eq("employee_id", employeeId)
          .maybeSingle(),
        supabase
          .from("employees")
          .select(EMPLOYEE_DETAILS_SELECT)
          .eq("employee_id", employeeId)
          .maybeSingle(),
      ]);

      if (historyError || employeeError) {
        setLoadError(historyError?.message ?? employeeError?.message ?? null);
        setPayrollRow(null);
        setEmployeeDetails(null);
        setLoadingPayslip(false);
        return;
      }

      setPayrollRow((historyRow as PayrollHistoryRow | null) ?? null);
      setEmployeeDetails(
        (employeeRow as PayslipEmployeeDetails | null) ?? null,
      );
      setLoadingPayslip(false);
    },
    [supabase],
  );

  useEffect(() => {
    if (!selectedMonth) {
      setPaidEmployees([]);
      setSelectedEmployeeId("");
      return;
    }

    void loadPaidEmployees(selectedMonth);
  }, [selectedMonth, loadPaidEmployees]);

  useEffect(() => {
    setSelectedEmployeeId("");
    setPayrollRow(null);
    setEmployeeDetails(null);
  }, [selectedMonth]);

  useEffect(() => {
    if (!selectedMonth || !selectedEmployeeId) {
      setPayrollRow(null);
      setEmployeeDetails(null);
      return;
    }

    void loadPayslip(selectedMonth, selectedEmployeeId);
  }, [selectedMonth, selectedEmployeeId, loadPayslip]);

  const monthLabel = selectedMonth ? formatMonthYearLabel(selectedMonth) : "";
  const totalWorkingDays = selectedMonth
    ? getTotalWorkingDays(selectedMonth)
    : 0;

  const earningsItems = useMemo((): PayslipLineItem[] => {
    if (!payrollRow) {
      return [];
    }

    const basicPay = getBasicPayAmount(payrollRow);
    const daysToPay = Number(payrollRow.days_to_pay) || 0;
    const dailyRate = Number(payrollRow.daily_rate) || 0;
    const isProrated =
      totalWorkingDays > 0 &&
      Math.abs(daysToPay - totalWorkingDays) >= 0.001 &&
      daysToPay < totalWorkingDays;

    return [
      {
        label: getBasicPayLabel(payrollRow.days_to_pay, totalWorkingDays),
        amount: basicPay,
        detail: isProrated
          ? `${formatGHS(dailyRate)} daily rate × ${daysToPay} day${daysToPay === 1 ? "" : "s"} to pay`
          : undefined,
      },
      {
        label: "Housing Allowance",
        amount: Number(payrollRow.housing_allowance) || 0,
      },
      {
        label: "Transport Allowance",
        amount: Number(payrollRow.transport_allowance) || 0,
      },
      {
        label: "Other Allowances",
        amount: Number(payrollRow.other_allowances) || 0,
      },
      {
        label: "Overtime",
        amount: Number(payrollRow.overtime_amount) || 0,
      },
      {
        label: "Bonuses",
        amount: Number(payrollRow.bonuses) || 0,
      },
      {
        label: "Arrears",
        amount: Number(payrollRow.arrears) || 0,
      },
    ];
  }, [payrollRow, totalWorkingDays]);

  const deductionsItems = useMemo((): PayslipLineItem[] => {
    if (!payrollRow) {
      return [];
    }

    return [
      {
        label: "Employee SSNIT",
        amount: Number(payrollRow.employee_ssnit) || 0,
      },
      {
        label: "PAYE Tax",
        amount: Number(payrollRow.paye_tax) || 0,
      },
      {
        label: "Loan Repayment",
        amount: Number(payrollRow.loan_repayment) || 0,
      },
      {
        label: "Salary Advance",
        amount: Number(payrollRow.salary_advance) || 0,
      },
      {
        label: "Welfare Deduction",
        amount: Number(payrollRow.welfare_deduction) || 0,
      },
      {
        label: "Absence Deduction",
        amount: Number(payrollRow.absence_deduction) || 0,
      },
      {
        label: "Other Deductions",
        amount: Number(payrollRow.other_deductions) || 0,
      },
    ];
  }, [payrollRow]);

  const paymentDetails = employeeDetails
    ? getPaymentDetails(employeeDetails)
    : null;

  const departmentName = employeeDetails
    ? getDepartmentName(
        new Map(),
        employeeDetails.department,
        employeeDetails.department_ref,
      )
    : "—";

  const positionName = employeeDetails
    ? getPositionName(positions, employeeDetails.position)
    : "—";

  const handlePrint = () => {
    window.print();
  };

  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load payslip data: {fetchError}
      </div>
    );
  }

  if (initialPayrollMonths.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No locked payroll periods yet — payslips are only available after a
        month is locked in Payroll Processing.
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }

          #payslip-print-area,
          #payslip-print-area * {
            visibility: visible;
          }

          #payslip-print-area {
            position: absolute;
            inset: 0;
            width: 100%;
            padding: 24px;
            background: white;
          }

          .no-print {
            display: none !important;
          }
        }
      `}</style>

      <div className="no-print mb-6 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[220px] flex-1">
            <label
              htmlFor="payslip-month"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Payroll Month
            </label>
            <select
              id="payslip-month"
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className={inputClassName}
            >
              {initialPayrollMonths.map((month) => (
                <option key={month} value={month}>
                  {formatMonthYearLabel(month)}
                </option>
              ))}
            </select>
          </div>

          <div className="min-w-[280px] flex-1">
            <label
              htmlFor="payslip-employee"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Employee
            </label>
            <select
              id="payslip-employee"
              value={selectedEmployeeId}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              disabled={loadingEmployees || paidEmployees.length === 0}
              className={inputClassName}
            >
              <option value="">
                {loadingEmployees
                  ? "Loading employees…"
                  : paidEmployees.length === 0
                    ? "No employees paid this month"
                    : "Select employee"}
              </option>
              {paidEmployees.map((employee) => (
                <option key={employee.employee_id} value={employee.employee_id}>
                  {employee.staff_id} — {employee.full_name}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            disabled={!payrollRow || !employeeDetails || loadingPayslip}
            className="rounded-md bg-[#0f2744] px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Print / Save PDF
          </button>
        </div>

        <p className="text-xs text-slate-500">
          Use your browser&apos;s print dialog and choose &quot;Save as
          PDF&quot; to download a PDF copy.
        </p>

        {loadError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {loadError}
          </div>
        ) : null}
      </div>

      {loadingEmployees ? (
        <LoadingState
          label="Loading employees…"
          size="sm"
          layout="section"
          className="min-h-[8rem] py-4"
        />
      ) : null}

      {!selectedEmployeeId ? (
        <div className="no-print rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
          Select a payroll month and employee to generate a payslip.
        </div>
      ) : loadingPayslip ? (
        <div className="no-print rounded-md border border-slate-200 bg-slate-50 px-4 py-4">
          <LoadingState label="Loading payslip…" size="md" layout="section" />
        </div>
      ) : !payrollRow || !employeeDetails ? (
        <div className="no-print rounded-md border border-amber-200 bg-amber-50 px-4 py-8 text-center text-sm text-amber-800">
          No payslip record found for this employee and month.
        </div>
      ) : (
        <div
          id="payslip-print-area"
          className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 shadow-sm"
        >
          <header className="mb-8 border-b-4 border-[#0f2744] pb-6">
            <div className="flex items-start justify-between gap-6">
              <div className="flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/logo.jpg"
                  alt="Davors Facilities logo"
                  className="h-16 w-16 rounded-md object-cover"
                />
                <div>
                  <h2 className="text-lg font-bold text-[#0f2744]">
                    Davors Facilities Management Services Ltd
                  </h2>
                  <p className="mt-1 text-base font-semibold text-slate-800">
                    Payslip for {monthLabel}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Generated {formatGeneratedDate()}
                  </p>
                </div>
              </div>
            </div>
          </header>

          <section className="mb-8">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
              Employee Details
            </h3>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div>
                <span className="text-slate-500">Staff ID</span>
                <p className="font-medium text-slate-900">
                  {employeeDetails.staff_id}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Full Name</span>
                <p className="font-medium text-slate-900">
                  {employeeDetails.full_name}
                </p>
              </div>
              <div>
                <span className="text-slate-500">Department</span>
                <p className="font-medium text-slate-900">{departmentName}</p>
              </div>
              <div>
                <span className="text-slate-500">Position</span>
                <p className="font-medium text-slate-900">{positionName}</p>
              </div>
              <div>
                <span className="text-slate-500">Employment Type</span>
                <p className="font-medium text-slate-900">
                  {employeeDetails.employment_type?.trim() || "—"}
                </p>
              </div>
            </div>
          </section>

          <PayslipAmountTable
            title="Earnings"
            items={earningsItems}
            subtotalLabel="Gross Pay"
            subtotalAmount={Number(payrollRow.gross_pay) || 0}
          />

          <PayslipAmountTable
            title="Deductions"
            items={deductionsItems}
            subtotalLabel="Total Deductions"
            subtotalAmount={Number(payrollRow.total_deductions) || 0}
          />

          <div className="mb-8 rounded-md bg-[#0f2744] px-6 py-4 text-white">
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Net Pay</span>
              <span className="text-2xl font-bold">
                {formatGHS(payrollRow.net_pay)}
              </span>
            </div>
          </div>

          <section className="mb-8 rounded-md border border-slate-200 bg-slate-50 px-5 py-4">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
              Employer Contributions
            </h3>
            <p className="mb-3 text-xs text-slate-500">
              Paid by Employer — not deducted from your pay.
            </p>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-slate-200">
                  <td className="py-2 text-slate-700">
                    Employer SSNIT (Tier 1)
                  </td>
                  <td className="py-2 text-right font-medium text-slate-900">
                    {formatGHS(payrollRow.employer_ssnit)}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 text-slate-700">Tier 2 Contribution</td>
                  <td className="py-2 text-right font-medium text-slate-900">
                    {formatGHS(payrollRow.tier2)}
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <footer className="border-t border-slate-200 pt-4 text-sm text-slate-600">
            {paymentDetails ? (
              <p className="mb-2">
                <span className="font-medium text-slate-700">
                  {paymentDetails.label}:
                </span>{" "}
                {paymentDetails.value}
              </p>
            ) : null}
            <p className="text-xs text-slate-500">
              This is a computer-generated payslip.
            </p>
          </footer>
        </div>
      )}
    </>
  );
}
