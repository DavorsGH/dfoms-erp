"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { formatGHS, inputClassName, compareStaffIds } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  buildPeriodKey,
  findMonthEndCloseForKey,
  formatPeriodLabel,
  getPeriodDisplayStatus,
  getPeriodSelectorLabel,
  isFullMonthPayrollLock,
  isMonthClosed,
  isPartiallyLockedMonth,
  normalizePayrollMonthValue,
  parsePeriodKey,
  payrollMonthToPeriodKey,
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
  resolveSelectedPeriod,
  type MonthEndCloseRecord,
  type SelectedPayrollPeriod,
} from "./payroll-period-utils";
import {
  buildManualInputsFromRow,
  buildProcessingPayload,
  calculateLoanRepaymentForEmployee,
  calculatePayrollRow,
  countAbsencesForStaff,
  sumOvertimeForEmployee,
  type PayrollAttendanceSource,
  type PayrollEmployeeSource,
  type PayrollHistoryRow,
  type PayrollOvertimeSource,
  type PayrollManualInputs,
  type PayrollProcessingRow,
  type PayrollTaxConfigs,
} from "./payroll-processing-utils";
import type { LoanRegisterEntry } from "./loan-register-utils";

type PayrollProcessingProps = {
  initialPayrollMonths: string[];
  initialMonthEndClose: MonthEndCloseRecord[];
  initialEmployees: PayrollEmployeeSource[];
  initialAttendance: PayrollAttendanceSource[];
  initialOvertime: PayrollOvertimeSource[];
  initialLoans: LoanRegisterEntry[];
  taxConfigs: PayrollTaxConfigs;
  isSuperAdmin: boolean;
  fetchError: string | null;
};

type WorkspaceRow = PayrollProcessingRow & {
  staff_id: string;
  full_name: string;
  employment_type: string | null;
};

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => ({
  value: index + 1,
  label: new Date(2000, index, 1).toLocaleDateString("en-GB", {
    month: "long",
  }),
}));

const YEAR_OPTIONS = Array.from({ length: 12 }, (_, index) => 2024 + index);

function sortWorkspaceRows(rows: WorkspaceRow[]): WorkspaceRow[] {
  return [...rows].sort((left, right) =>
    compareStaffIds(left.staff_id, right.staff_id),
  );
}

function toWorkspaceRow(
  row: PayrollProcessingRow | PayrollHistoryRow,
  employee: PayrollEmployeeSource | undefined,
): WorkspaceRow {
  return {
    ...row,
    staff_id: employee?.staff_id ?? "—",
    full_name: employee?.full_name ?? row.employee_id,
    employment_type: employee?.employment_type ?? null,
  };
}

export default function PayrollProcessing({
  initialPayrollMonths,
  initialMonthEndClose,
  initialEmployees,
  initialAttendance,
  initialOvertime,
  initialLoans,
  taxConfigs,
  isSuperAdmin,
  fetchError,
}: PayrollProcessingProps) {
  const supabase = createClient();
  const now = new Date();
  const [knownPayrollMonths, setKnownPayrollMonths] =
    useState(initialPayrollMonths);
  const [monthEndCloseRows, setMonthEndCloseRows] = useState(
    initialMonthEndClose,
  );
  const [employees] = useState(initialEmployees);
  const [attendance] = useState(initialAttendance);
  const [overtime] = useState(initialOvertime);
  const [loans] = useState(initialLoans);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState(
    buildPeriodKey(now.getFullYear(), now.getMonth() + 1),
  );
  const [currentPeriod, setCurrentPeriod] = useState<SelectedPayrollPeriod | null>(
    null,
  );
  const [monthEndClose, setMonthEndClose] = useState<MonthEndCloseRecord | null>(
    null,
  );
  const [periodHasProcessingRows, setPeriodHasProcessingRows] = useState(false);
  const [partialLockDialogOpen, setPartialLockDialogOpen] = useState(false);
  const [partialLockNote, setPartialLockNote] = useState("");
  const [pendingLockRows, setPendingLockRows] = useState<PayrollProcessingRow[]>(
    [],
  );
  const [rows, setRows] = useState<WorkspaceRow[]>([]);
  const [expandedEmployeeId, setExpandedEmployeeId] = useState<string | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const employeeMap = useMemo(
    () => new Map(employees.map((employee) => [employee.employee_id, employee])),
    [employees],
  );

  const activeEmployees = useMemo(
    () =>
      employees.filter((employee) => employee.employment_status === "Active"),
    [employees],
  );

  const activeEmployeeIds = useMemo(
    () => new Set(activeEmployees.map((employee) => employee.employee_id)),
    [activeEmployees],
  );

  const isPeriodClosed = isMonthClosed(monthEndClose);

  function getRowSources(
    employee: PayrollEmployeeSource,
    period: SelectedPayrollPeriod,
  ) {
    return {
      absenceCount: countAbsencesForStaff(
        attendance,
        employee.staff_id,
        period.year,
        period.month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        overtime,
        employee.employee_id,
        period.year,
        period.month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        loans,
        employee.employee_id,
      ),
    };
  }

  function recalculateWorkspaceRow(
    row: PayrollProcessingRow,
    employee: PayrollEmployeeSource,
    period: SelectedPayrollPeriod,
    manualOverrides: Partial<PayrollManualInputs> = {},
  ): WorkspaceRow {
    const calculated = calculatePayrollRow(
      employee,
      period,
      taxConfigs,
      getRowSources(employee, period),
      {
        ...buildManualInputsFromRow(row, period.totalWorkingDays),
        ...manualOverrides,
      },
    );

    return toWorkspaceRow(
      {
        ...row,
        ...buildProcessingPayload(period.payrollMonth, employee, calculated),
        id: row.id,
      },
      employee,
    );
  }

  const periodOptions = useMemo(() => {
    const keys = new Set<string>();

    for (const payrollMonth of knownPayrollMonths) {
      const key = payrollMonthToPeriodKey(payrollMonth);
      if (key) {
        keys.add(key);
      }
    }

    for (const record of monthEndCloseRows) {
      const key = payrollMonthToPeriodKey(record.month);
      if (key) {
        keys.add(key);
      }
    }

    keys.add(selectedPeriodKey);

    return [...keys]
      .sort((left, right) => right.localeCompare(left))
      .map((key) => {
        const parsed = parsePeriodKey(key);
        if (!parsed) {
          return null;
        }

        const closeRecord = findMonthEndCloseForKey(monthEndCloseRows, key);

        return {
          key,
          label: getPeriodSelectorLabel(
            parsed.year,
            parsed.month,
            closeRecord ?? null,
          ),
        };
      })
      .filter((option): option is { key: string; label: string } => option !== null);
  }, [knownPayrollMonths, monthEndCloseRows, selectedPeriodKey]);

  const totals = useMemo(() => {
    return rows.reduce(
      (accumulator, row) => ({
        grossPay: accumulator.grossPay + (Number(row.gross_pay) || 0),
        totalDeductions:
          accumulator.totalDeductions + (Number(row.total_deductions) || 0),
        netPay: accumulator.netPay + (Number(row.net_pay) || 0),
        employerSsnitCost:
          accumulator.employerSsnitCost +
          (Number(row.employer_ssnit) || 0) +
          (Number(row.tier2) || 0),
      }),
      {
        grossPay: 0,
        totalDeductions: 0,
        netPay: 0,
        employerSsnitCost: 0,
      },
    );
  }, [rows]);

  useEffect(() => {
    void loadWorkspace(selectedPeriodKey);
  }, [selectedPeriodKey]);

  async function fetchMonthEndClose(
    payrollMonth: string,
  ): Promise<MonthEndCloseRecord | null> {
    const { data, error: closeError } = await supabase
      .from("month_end_close")
      .select("*")
      .eq("month", payrollMonth)
      .maybeSingle();

    if (closeError) {
      throw new Error(closeError.message);
    }

    return (data as MonthEndCloseRecord | null) ?? null;
  }

  async function syncOpenPeriod(period: SelectedPayrollPeriod) {
    const { data: existingRows, error: existingError } = await supabase
      .from("payroll_processing")
      .select("id, employee_id")
      .eq("payroll_month", period.payrollMonth);

    if (existingError) {
      throw new Error(existingError.message);
    }

    const existingEmployeeIds = new Set(
      (
        (existingRows as Pick<PayrollProcessingRow, "id" | "employee_id">[] | null) ??
        []
      ).map((row) => row.employee_id),
    );

    const activeEmployeeIds = new Set(
      activeEmployees.map((employee) => employee.employee_id),
    );
    const staleRowIds = (
      (existingRows as Pick<PayrollProcessingRow, "id" | "employee_id">[] | null) ??
      []
    )
      .filter((row) => !activeEmployeeIds.has(row.employee_id))
      .map((row) => row.id);

    if (staleRowIds.length > 0) {
      const { error: deleteStaleError } = await supabase
        .from("payroll_processing")
        .delete()
        .in("id", staleRowIds);

      if (deleteStaleError) {
        throw new Error(deleteStaleError.message);
      }
    }

    const rowsToInsert = activeEmployees
      .filter((employee) => !existingEmployeeIds.has(employee.employee_id))
      .map((employee) => {
        const absenceCount = countAbsencesForStaff(
          attendance,
          employee.staff_id,
          period.year,
          period.month,
        );
        const overtimeAmount = sumOvertimeForEmployee(
          overtime,
          employee.employee_id,
          period.year,
          period.month,
        );
        const loanRepayment = calculateLoanRepaymentForEmployee(
          loans,
          employee.employee_id,
        );

        const calculated = calculatePayrollRow(
          employee,
          period,
          taxConfigs,
          { absenceCount, overtimeAmount, loanRepayment },
          {
            days_to_pay: period.totalWorkingDays,
            bonuses: 0,
            arrears: 0,
            salary_advance: 0,
            welfare_deduction: 0,
            other_deductions: 0,
          },
        );

        return buildProcessingPayload(period.payrollMonth, employee, calculated);
      });

    if (rowsToInsert.length > 0) {
      const { error: insertError } = await supabase
        .from("payroll_processing")
        .upsert(rowsToInsert, {
          onConflict: "payroll_month,employee_id",
          ignoreDuplicates: true,
        });

      if (insertError) {
        throw new Error(insertError.message);
      }
    }

    setKnownPayrollMonths((current) =>
      current.includes(period.payrollMonth)
        ? current
        : [...current, period.payrollMonth],
    );
  }

  async function loadWorkspace(periodKey: string) {
    const parsed = parsePeriodKey(periodKey);
    if (!parsed) {
      return;
    }

    setLoading(true);
    setError(null);
    setExpandedEmployeeId(null);

    try {
      const period = resolveSelectedPeriod(parsed.year, parsed.month);
      setCurrentPeriod(period);

      const closeRecord = await fetchMonthEndClose(period.payrollMonth);
      setMonthEndClose(closeRecord);

      if (isMonthClosed(closeRecord)) {
        const { data, error: historyError } = await supabase
          .from("payroll_history")
          .select("*")
          .eq("payroll_month", period.payrollMonth)
          .order("employee_id", { ascending: true });

        if (historyError) {
          throw new Error(historyError.message);
        }

        const historyRows = (data as PayrollHistoryRow[] | null) ?? [];
        setPeriodHasProcessingRows(historyRows.length > 0);
        setRows(
          sortWorkspaceRows(
            historyRows.map((row) =>
              toWorkspaceRow(row, employeeMap.get(row.employee_id)),
            ),
          ),
        );
        setLoading(false);
        return;
      }

      const { count: processingCount, error: processingCountError } =
        await supabase
          .from("payroll_processing")
          .select("id", { count: "exact", head: true })
          .eq("payroll_month", period.payrollMonth);

      if (processingCountError) {
        throw new Error(processingCountError.message);
      }

      await syncOpenPeriod(period);

      const { data, error: processingError } = await supabase
        .from("payroll_processing")
        .select("*")
        .eq("payroll_month", period.payrollMonth)
        .order("employee_id", { ascending: true });

      if (processingError) {
        throw new Error(processingError.message);
      }

      const processingRows = (data as PayrollProcessingRow[] | null) ?? [];
      setPeriodHasProcessingRows(
        (processingCount ?? 0) > 0 || processingRows.length > 0,
      );
      setRows(
        sortWorkspaceRows(
          processingRows.map((row) => {
            const employee = employeeMap.get(row.employee_id);
            if (!employee) {
              return toWorkspaceRow(row, employee);
            }

            return recalculateWorkspaceRow(row, employee, period);
          }),
        ),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Failed to load payroll.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateRowField(
    row: WorkspaceRow,
    updates: Partial<{
      days_to_pay: number;
      bonuses: number;
      arrears: number;
      salary_advance: number;
      welfare_deduction: number;
      other_deductions: number;
    }>,
  ) {
    if (!currentPeriod || isPeriodClosed) {
      return;
    }

    const employee = employeeMap.get(row.employee_id);
    if (!employee) {
      return;
    }

    setError(null);

    const calculated = calculatePayrollRow(
      employee,
      currentPeriod,
      taxConfigs,
      getRowSources(employee, currentPeriod),
      {
        ...buildManualInputsFromRow(row, currentPeriod.totalWorkingDays),
        ...updates,
      },
    );

    const payload = buildProcessingPayload(
      currentPeriod.payrollMonth,
      employee,
      calculated,
    );

    const { error: saveError } = await supabase
      .from("payroll_processing")
      .update(payload)
      .eq("id", row.id);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    const updatedRow = recalculateWorkspaceRow(row, employee, currentPeriod, updates);
    setRows((current) =>
      current.map((entry) =>
        entry.id === row.id ? updatedRow : entry,
      ),
    );
  }

  async function executeLockPeriod(
    rowsToLock: PayrollProcessingRow[],
    lockStatus: typeof PAYROLL_STATUS_LOCKED | typeof PAYROLL_STATUS_PARTIALLY_LOCKED,
    notes: string | null,
  ) {
    if (!currentPeriod) {
      return;
    }

    const lockedAt = new Date().toISOString();
    const totalNetPay = rowsToLock.reduce(
      (sum, row) => sum + (Number(row.net_pay) || 0),
      0,
    );

    const historyRows = rowsToLock.map((row) => {
      const { id: _processingId, ...rest } = row;
      return {
        ...rest,
        locked: true,
        locked_at: lockedAt,
      };
    });

    if (historyRows.length > 0) {
      const { error: historyError } = await supabase
        .from("payroll_history")
        .insert(historyRows);

      if (historyError) {
        throw new Error(historyError.message);
      }
    }

    const { error: deleteError } = await supabase
      .from("payroll_processing")
      .delete()
      .eq("payroll_month", currentPeriod.payrollMonth);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const monthEndPayload = {
      month: currentPeriod.payrollMonth,
      employees_recorded: historyRows.length,
      total_net_pay: Math.round(totalNetPay * 100) / 100,
      lock_status: lockStatus,
      notes,
    };

    const { data: closeRecord, error: closeError } = await supabase
      .from("month_end_close")
      .upsert(monthEndPayload, { onConflict: "month" })
      .select("*")
      .single();

    if (closeError) {
      throw new Error(closeError.message);
    }

    const lockedRecord = closeRecord as MonthEndCloseRecord;
    setMonthEndClose(lockedRecord);
    setMonthEndCloseRows((current) => {
      const normalizedMonth = normalizePayrollMonthValue(lockedRecord.month);
      const withoutCurrent = current.filter(
        (record) =>
          normalizePayrollMonthValue(record.month) !== normalizedMonth,
      );
      return [...withoutCurrent, lockedRecord];
    });
    setKnownPayrollMonths((current) =>
      current.includes(currentPeriod.payrollMonth)
        ? current
        : [...current, currentPeriod.payrollMonth],
    );
    await loadWorkspace(selectedPeriodKey);
  }

  async function handleLockPeriod() {
    if (!currentPeriod || !isSuperAdmin || isPeriodClosed) {
      return;
    }

    const label = formatPeriodLabel(currentPeriod.year, currentPeriod.month);

    if (
      !window.confirm(
        `This will lock ${label} payroll permanently. Continue?`,
      )
    ) {
      return;
    }

    setLocking(true);
    setError(null);

    try {
      const { data: processingRows, error: fetchErrorMessage } = await supabase
        .from("payroll_processing")
        .select("*")
        .eq("payroll_month", currentPeriod.payrollMonth);

      if (fetchErrorMessage) {
        throw new Error(fetchErrorMessage.message);
      }

      const rowsToLock = ((processingRows as PayrollProcessingRow[] | null) ?? [])
        .map((row) => {
          const employee = employeeMap.get(row.employee_id);
          if (!employee) {
            return row;
          }

          const calculated = calculatePayrollRow(
            employee,
            currentPeriod,
            taxConfigs,
            getRowSources(employee, currentPeriod),
            buildManualInputsFromRow(row, currentPeriod.totalWorkingDays),
          );

          return {
            ...row,
            ...buildProcessingPayload(
              currentPeriod.payrollMonth,
              employee,
              calculated,
            ),
          };
        });

      const isFullMonth = isFullMonthPayrollLock(
        rowsToLock,
        activeEmployeeIds,
        currentPeriod.totalWorkingDays,
      );

      if (isFullMonth) {
        await executeLockPeriod(rowsToLock, PAYROLL_STATUS_LOCKED, null);
      } else {
        setPendingLockRows(rowsToLock);
        setPartialLockNote("");
        setPartialLockDialogOpen(true);
      }
    } catch (lockError) {
      setError(
        lockError instanceof Error
          ? lockError.message
          : "Failed to lock payroll period.",
      );
    } finally {
      setLocking(false);
    }
  }

  async function confirmPartialLock() {
    const note = partialLockNote.trim();
    if (!note) {
      setError("Add a note explaining this partial payment before locking.");
      return;
    }

    setPartialLockDialogOpen(false);
    setLocking(true);
    setError(null);

    try {
      await executeLockPeriod(
        pendingLockRows,
        PAYROLL_STATUS_PARTIALLY_LOCKED,
        note,
      );
      setPendingLockRows([]);
      setPartialLockNote("");
    } catch (lockError) {
      setError(
        lockError instanceof Error
          ? lockError.message
          : "Failed to lock payroll period.",
      );
    } finally {
      setLocking(false);
    }
  }

  const selectedParsed = parsePeriodKey(selectedPeriodKey);
  const periodStatus = getPeriodDisplayStatus(
    monthEndClose,
    periodHasProcessingRows,
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap gap-4">
          <div className="min-w-[220px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Payroll Period
            </label>
            <select
              value={selectedPeriodKey}
              onChange={(event) => setSelectedPeriodKey(event.target.value)}
              className={inputClassName}
              disabled={loading || locking}
            >
              {periodOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Month
            </label>
            <select
              value={selectedParsed?.month ?? now.getMonth() + 1}
              onChange={(event) => {
                const year = selectedParsed?.year ?? now.getFullYear();
                setSelectedPeriodKey(
                  buildPeriodKey(year, Number(event.target.value)),
                );
              }}
              className={inputClassName}
              disabled={loading || locking}
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[120px]">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Year
            </label>
            <select
              value={selectedParsed?.year ?? now.getFullYear()}
              onChange={(event) => {
                const month = selectedParsed?.month ?? now.getMonth() + 1;
                setSelectedPeriodKey(
                  buildPeriodKey(Number(event.target.value), month),
                );
              }}
              className={inputClassName}
              disabled={loading || locking}
            >
              {YEAR_OPTIONS.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        {isSuperAdmin && !isPeriodClosed ? (
          <button
            type="button"
            onClick={handleLockPeriod}
            disabled={locking || loading || rows.length === 0}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {locking ? "Locking…" : "Lock Period"}
          </button>
        ) : null}
      </div>

      {currentPeriod ? (
        <p className="text-sm text-slate-600">
          Working days in period:{" "}
          <span className="font-medium text-[#0f2744]">
            {currentPeriod.totalWorkingDays}
          </span>
          {" · "}
          Status:{" "}
          <span className="font-medium text-[#0f2744]">{periodStatus}</span>
        </p>
      ) : null}

      {isPeriodClosed ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {isPartiallyLockedMonth(monthEndClose)
            ? `This period is partially locked — view only.${
                monthEndClose?.notes?.trim()
                  ? ` Note: ${monthEndClose.notes.trim()}`
                  : ""
              }`
            : "This period is locked — view only."}
        </p>
      ) : null}

      {partialLockDialogOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-[#0f2744]">
              Partial payment lock
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This month is being locked as a partial payment. Add a note (e.g.
              &quot;Half month pay - 15 of 27 days&quot;).
            </p>
            <textarea
              value={partialLockNote}
              onChange={(event) => setPartialLockNote(event.target.value)}
              rows={4}
              className={`${inputClassName} mt-4 w-full`}
              placeholder="Half month pay - 15 of 27 days"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setPartialLockDialogOpen(false);
                  setPendingLockRows([]);
                  setPartialLockNote("");
                }}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmPartialLock()}
                disabled={locking || !partialLockNote.trim()}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {locking ? "Locking…" : "Lock as Partial"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-600">Loading payroll workspace…</p>
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
              {!isPeriodClosed ? (
                <th className={scrollableTableThClassName}>Adjustments</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={isPeriodClosed ? 12 : 13}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  {isPeriodClosed
                    ? "No locked payroll records for this period."
                    : "No active employees to process for this period."}
                </td>
              </tr>
            ) : (
              rows.flatMap((row) => {
                const mainRow = (
                  <tr key={row.id} className="text-slate-700">
                    <td className="px-4 py-3">{row.staff_id}</td>
                    <td className="px-4 py-3">{row.full_name}</td>
                    <td className="px-4 py-3">
                      {isPeriodClosed ? (
                        row.days_to_pay ?? "—"
                      ) : (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.days_to_pay ?? ""}
                          onChange={(event) =>
                            void updateRowField(row, {
                              days_to_pay: Number(event.target.value) || 0,
                            })
                          }
                          className={`${inputClassName} max-w-[96px]`}
                        />
                      )}
                    </td>
                    <td className="px-4 py-3">{formatGHS(row.basic_salary)}</td>
                    <td className="px-4 py-3">
                      {formatGHS(row.absence_deduction)}
                    </td>
                    <td className="px-4 py-3">
                      {formatGHS(row.overtime_amount)}
                    </td>
                    <td className="px-4 py-3">{formatGHS(row.gross_pay)}</td>
                    <td className="px-4 py-3">
                      {formatGHS(row.employee_ssnit)}
                    </td>
                    <td className="px-4 py-3">{formatGHS(row.paye_tax)}</td>
                    <td className="px-4 py-3">
                      {formatGHS(row.loan_repayment)}
                    </td>
                    <td className="px-4 py-3">
                      {formatGHS(row.total_deductions)}
                    </td>
                    <td className="px-4 py-3">{formatGHS(row.net_pay)}</td>
                    {!isPeriodClosed ? (
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedEmployeeId((current) =>
                              current === row.employee_id
                                ? null
                                : row.employee_id,
                            )
                          }
                          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          {expandedEmployeeId === row.employee_id
                            ? "Hide"
                            : "Adjust"}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                );

                if (expandedEmployeeId !== row.employee_id || isPeriodClosed) {
                  return [mainRow];
                }

                return [
                  mainRow,
                  <tr key={`${row.id}-adjustments`} className="bg-slate-50">
                    <td colSpan={13} className="px-4 py-4">
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        {(
                          [
                            ["bonuses", "Bonuses"],
                            ["arrears", "Arrears"],
                            ["salary_advance", "Salary Advance"],
                            ["welfare_deduction", "Welfare Deduction"],
                            ["other_deductions", "Other Deductions"],
                          ] as const
                        ).map(([field, label]) => (
                          <div key={field}>
                            <label className="mb-1 block text-sm font-medium text-slate-700">
                              {label}
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={Number(row[field]) || 0}
                              onChange={(event) =>
                                void updateRowField(row, {
                                  [field]: Number(event.target.value) || 0,
                                })
                              }
                              className={inputClassName}
                            />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>,
                ];
              })
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
