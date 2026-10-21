"use client";

import Tooltip from "@/components/ui/tooltip";
import { LoadingState } from "@/components/loading-indicator";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  scrollableTableStickyFirstTdClassName,
  scrollableTableStickyFirstThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import { downloadCsv } from "../reports/report-ui";
import PayrollTableFilterBar, {
  PayrollFilteredTotalsCard,
  PayrollSortableHeader,
} from "./payroll-table-filter-bar";
import {
  collectPayrollFilterOptions,
  defaultPayrollTableSort,
  enrichPayrollFilterLabels,
  filterPayrollTableRows,
  filteredPayrollBannerLabel,
  payrollFiltersFromSearchParams,
  payrollFiltersToSearchParams,
  payrollTableFiltersActive,
  sortPayrollTableRows,
  sumPayrollMoneyTotals,
  type PayrollTableFilters,
} from "./payroll-table-filters";
import type { RegisterColumnSortState } from "../finance/register-column-filter";
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
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";

type PayrollHistoryEmployee = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  employment_type: string | null;
  position: string | null;
  shift: string | null;
  contract_project: string | null;
  assigned_site_id: string | null;
};

type PayrollHistoryProps = {
  initialPayrollMonths: string[];
  initialMonthEndClose: MonthEndCloseRecord[];
  initialEmployees: PayrollHistoryEmployee[];
  initialSiteNameByCode: Record<string, string>;
  fetchError: string | null;
};

type HistoryWorkspaceRow = PayrollHistoryRow & {
  staff_id: string;
  full_name: string;
  contractLabel: string;
  siteLabel: string;
  positionLabel: string;
  employmentTypeLabel: string;
  shiftLabel: string;
};

type EmployeePayHistoryLine = {
  id: string;
  payroll_month: string;
  periodKey: string;
  monthLabel: string;
  days_to_pay: number | null;
  basic_salary: number | null;
  absence_deduction: number | null;
  overtime_amount: number | null;
  gross_pay: number | null;
  employee_ssnit: number | null;
  paye_tax: number | null;
  welfare_deduction: number | null;
  net_pay: number | null;
};

function sortHistoryRows(rows: HistoryWorkspaceRow[]): HistoryWorkspaceRow[] {
  return [...rows].sort((left, right) =>
    compareStaffIds(left.staff_id, right.staff_id),
  );
}

function toHistoryWorkspaceRow(
  row: PayrollHistoryRow,
  employee: PayrollHistoryEmployee | undefined,
  siteNameByCode: Map<string, string>,
): HistoryWorkspaceRow {
  const labels = enrichPayrollFilterLabels({
    contractProject: employee?.contract_project,
    projectContract: row.project_contract,
    siteCode: employee?.assigned_site_id,
    siteNameByCode,
    position: employee?.position,
    employmentType: employee?.employment_type,
    shift: employee?.shift,
  });

  return {
    ...row,
    staff_id: employee?.staff_id ?? "—",
    full_name: employee?.full_name ?? row.employee_id,
    ...labels,
  };
}

function resolvePayrollMonthForPeriod(
  periodKey: string | null,
  months: string[],
): string {
  if (!periodKey || months.length === 0) {
    return months[0] ?? "";
  }
  const match = months.find(
    (month) => payrollMonthToPeriodKey(month) === periodKey,
  );
  return match ?? months[0] ?? "";
}

function DaysToPayCell({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) {
    return (
      <Tooltip content="Not recorded for this period">
        <span className="cursor-help border-b border-dotted border-slate-400">
          —
        </span>
      </Tooltip>
    );
  }
  return <>{value}</>;
}

export default function PayrollHistory({
  initialPayrollMonths,
  initialMonthEndClose,
  initialEmployees,
  initialSiteNameByCode,
  fetchError,
}: PayrollHistoryProps) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlBootstrap = useMemo(
    () => payrollFiltersFromSearchParams(searchParams),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- seed once from URL
    [],
  );
  const [siteNameByCode] = useState(
    () => new Map(Object.entries(initialSiteNameByCode)),
  );
  const [tableFilters, setTableFilters] = useState<PayrollTableFilters>(
    () => urlBootstrap.filters,
  );
  const [tableSort, setTableSort] = useState<RegisterColumnSortState | null>(
    () => urlBootstrap.sort ?? defaultPayrollTableSort(),
  );
  const urlSyncReady = useRef(false);
  const [monthEndCloseRows, setMonthEndCloseRows] = useState(
    initialMonthEndClose,
  );
  const [monthEndClose, setMonthEndClose] = useState<MonthEndCloseRecord | null>(
    null,
  );
  const [employees, setEmployees] = useState(initialEmployees);
  const [payrollMonths, setPayrollMonths] = useState(initialPayrollMonths);
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState(() =>
    resolvePayrollMonthForPeriod(urlBootstrap.period, initialPayrollMonths),
  );
  const [rows, setRows] = useState<HistoryWorkspaceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [employeeHistoryOpen, setEmployeeHistoryOpen] = useState(false);
  const [employeeHistoryLoading, setEmployeeHistoryLoading] = useState(false);
  const [employeeHistoryError, setEmployeeHistoryError] = useState<
    string | null
  >(null);
  const [employeeHistoryLines, setEmployeeHistoryLines] = useState<
    EmployeePayHistoryLine[]
  >([]);
  const [employeeHistoryForId, setEmployeeHistoryForId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    setMonthEndCloseRows(initialMonthEndClose);
  }, [initialMonthEndClose]);

  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  useEffect(() => {
    setPayrollMonths(initialPayrollMonths);
    if (
      initialPayrollMonths.length > 0 &&
      !initialPayrollMonths.includes(selectedPayrollMonth)
    ) {
      setSelectedPayrollMonth(
        resolvePayrollMonthForPeriod(urlBootstrap.period, initialPayrollMonths),
      );
    }
  }, [initialPayrollMonths, selectedPayrollMonth, urlBootstrap.period]);

  useEffect(() => {
    setError(fetchError);
  }, [fetchError]);

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

        const closeRecord = findMonthEndCloseForKey(
          monthEndCloseRows,
          key,
          buReadScope.mode === "all"
            ? undefined
            : buReadScope.mode === "unit"
              ? buReadScope.id
              : null,
        );

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
  }, [payrollMonths, monthEndCloseRows, buReadScope]);

  const periodTotals = useMemo(() => sumPayrollMoneyTotals(rows), [rows]);

  const filtersActive = payrollTableFiltersActive(tableFilters);

  const filterOptions = useMemo(
    () => collectPayrollFilterOptions(rows),
    [rows],
  );

  const filteredRows = useMemo(() => {
    const filtered = filterPayrollTableRows(rows, tableFilters);
    return sortPayrollTableRows(filtered, tableSort, (row, columnId) => {
      switch (columnId) {
        case "days_to_pay":
          return row.days_to_pay;
        case "basic_salary":
          return row.basic_salary;
        case "absence_deduction":
          return row.absence_deduction;
        case "overtime_amount":
          return row.overtime_amount;
        case "gross_pay":
          return row.gross_pay;
        case "employee_ssnit":
          return row.employee_ssnit;
        case "paye_tax":
          return row.paye_tax;
        case "loan_repayment":
          return row.loan_repayment;
        case "total_deductions":
          return row.total_deductions;
        case "net_pay":
          return row.net_pay;
        default:
          return null;
      }
    });
  }, [rows, tableFilters, tableSort]);

  const filteredTotals = useMemo(
    () => sumPayrollMoneyTotals(filteredRows),
    [filteredRows],
  );

  const singleFilteredEmployee =
    filteredRows.length === 1 ? filteredRows[0]! : null;

  useEffect(() => {
    if (!urlSyncReady.current) {
      urlSyncReady.current = true;
      return;
    }
    const params = payrollFiltersToSearchParams(
      selectedPeriodKey,
      tableFilters,
      tableSort,
    );
    for (const [key, value] of searchParams.entries()) {
      if (
        ![
          "period",
          "q",
          "contract",
          "site",
          "position",
          "empType",
          "shift",
          "absence",
          "ot",
          "missingBasic",
          "sort",
        ].includes(key)
      ) {
        params.set(key, value);
      }
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeriodKey, tableFilters, tableSort]);

  useEffect(() => {
    if (!selectedPayrollMonth) {
      setRows([]);
      setMonthEndClose(null);
      return;
    }

    void loadHistory(selectedPayrollMonth);
    // employees / buReadScope: re-fetch MEC + filter when switcher + prop sync update.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadHistory closes over latest helpers
  }, [selectedPayrollMonth, buReadScope, employees]);

  useEffect(() => {
    if (
      !singleFilteredEmployee ||
      employeeHistoryForId !== singleFilteredEmployee.employee_id
    ) {
      setEmployeeHistoryOpen(false);
      setEmployeeHistoryLines([]);
      setEmployeeHistoryForId(null);
      setEmployeeHistoryError(null);
    }
  }, [singleFilteredEmployee, employeeHistoryForId]);

  async function loadHistory(payrollMonth: string) {
    setLoading(true);
    setError(null);
    // Clear immediately so a BU switch never leaves the previous unit's lock banner visible.
    setMonthEndClose(null);

    try {
      // All Businesses: multiple MEC rows possible; do not pick one BU's lock status.
      let nextClose: MonthEndCloseRecord | null = null;
      if (buReadScope.mode !== "all") {
        const { data: closeRecord, error: closeError } =
          await applyBusinessUnitScope(
            supabase
              .from("month_end_close")
              .select("*")
              .eq("month", payrollMonth),
            buReadScope,
          ).maybeSingle();

        if (closeError) {
          throw new Error(closeError.message);
        }

        nextClose = (closeRecord as MonthEndCloseRecord | null) ?? null;
      }

      setMonthEndClose(nextClose);

      const { data, error: historyError } = await supabase
        .from("payroll_history")
        .select("*")
        .eq("payroll_month", payrollMonth)
        .order("employee_id", { ascending: true });

      if (historyError) {
        throw new Error(historyError.message);
      }

      const scopedRows = (
        (data as PayrollHistoryRow[] | null) ?? []
      ).filter((row) => employeeMap.has(row.employee_id));

      setRows(
        sortHistoryRows(
          scopedRows.map((row) =>
            toHistoryWorkspaceRow(
              row,
              employeeMap.get(row.employee_id),
              siteNameByCode,
            ),
          ),
        ),
      );
    } catch (loadError) {
      setRows([]);
      setMonthEndClose(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load payroll history.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadEmployeePayHistory(employeeId: string) {
    setEmployeeHistoryLoading(true);
    setEmployeeHistoryError(null);
    setEmployeeHistoryOpen(true);
    setEmployeeHistoryForId(employeeId);

    try {
      const { data, error: historyError } = await supabase
        .from("payroll_history")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("locked", true)
        .order("payroll_month", { ascending: false });

      if (historyError) {
        throw new Error(historyError.message);
      }

      const lines: EmployeePayHistoryLine[] = (
        (data as PayrollHistoryRow[] | null) ?? []
      )
        .map((row) => {
          const periodKey = payrollMonthToPeriodKey(row.payroll_month) ?? "";
          const parsed = parsePeriodKey(periodKey);
          return {
            id: row.id,
            payroll_month: row.payroll_month,
            periodKey,
            monthLabel: parsed
              ? formatPeriodLabel(parsed.year, parsed.month)
              : row.payroll_month,
            days_to_pay: row.days_to_pay,
            basic_salary: row.basic_salary,
            absence_deduction: row.absence_deduction,
            overtime_amount: row.overtime_amount,
            gross_pay: row.gross_pay,
            employee_ssnit: row.employee_ssnit,
            paye_tax: row.paye_tax,
            welfare_deduction: row.welfare_deduction,
            net_pay: row.net_pay,
          };
        })
        .sort((left, right) =>
          right.periodKey.localeCompare(left.periodKey),
        );

      setEmployeeHistoryLines(lines);
    } catch (loadError) {
      setEmployeeHistoryLines([]);
      setEmployeeHistoryError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load employee pay history.",
      );
    } finally {
      setEmployeeHistoryLoading(false);
    }
  }

  function exportFilteredCsv() {
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
    const body = filteredRows.map((row) => [
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
    ]);
    const prefix = filtersActive
      ? [
          [
            filteredPayrollBannerLabel(filteredRows.length, rows.length),
            ...Array(headers.length - 1).fill(""),
          ],
        ]
      : [];
    downloadCsv(
      `payroll-history-${periodLabel.replace(/\s+/g, "-").toLowerCase()}.csv`,
      headers,
      [...prefix, ...body],
    );
  }

  function exportEmployeeHistoryCsv() {
    if (!singleFilteredEmployee) return;
    const headers = [
      "Month",
      "Days to Pay",
      "Basic Salary",
      "Absence Deduction",
      "Overtime",
      "Gross Pay",
      "Employee SSNIT",
      "PAYE Tax",
      "Welfare",
      "Net Pay",
    ];
    const body = employeeHistoryLines.map((line) => [
      line.monthLabel,
      line.days_to_pay ?? "",
      line.basic_salary ?? "",
      line.absence_deduction ?? "",
      line.overtime_amount ?? "",
      line.gross_pay ?? "",
      line.employee_ssnit ?? "",
      line.paye_tax ?? "",
      line.welfare_deduction ?? "",
      line.net_pay ?? "",
    ]);
    downloadCsv(
      `pay-history-${singleFilteredEmployee.staff_id}.csv`,
      headers,
      body,
    );
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
            onClick={exportFilteredCsv}
            disabled={filteredRows.length === 0}
            className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                {formatGHS(periodTotals.employeeSsnit)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Employer SSNIT:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(periodTotals.employerSsnit)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Employer SSNIT Tier 2:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(periodTotals.tier2)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              PAYE Tax:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(periodTotals.payeTax)}
              </span>
            </p>
            <p className="text-sm text-slate-600">
              Total Employer SSNIT Cost:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(periodTotals.employerSsnitCost)}
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
        <LoadingState label="Loading payroll history…" size="md" layout="section" />
      ) : null}

      {!loading && rows.length > 0 ? (
        <>
          <PayrollTableFilterBar
            filters={tableFilters}
            onChange={setTableFilters}
            options={filterOptions}
          />
          <FilteredListCount
            filteredCount={filteredRows.length}
            totalCount={rows.length}
            itemSingular="employee"
            hasActiveFilters={filtersActive}
          />
          {singleFilteredEmployee ? (
            <p className="text-sm text-slate-700">
              <button
                type="button"
                className="font-medium text-[#0f2744] underline"
                onClick={() =>
                  void loadEmployeePayHistory(
                    singleFilteredEmployee.employee_id,
                  )
                }
              >
                See {singleFilteredEmployee.full_name}&apos;s pay history
              </button>
            </p>
          ) : null}
        </>
      ) : null}

      {employeeHistoryOpen && singleFilteredEmployee ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
              {singleFilteredEmployee.full_name}&apos;s pay history
            </h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={employeeHistoryLines.length === 0}
                onClick={exportEmployeeHistoryCsv}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => {
                  setEmployeeHistoryOpen(false);
                  setEmployeeHistoryLines([]);
                  setEmployeeHistoryForId(null);
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
          {employeeHistoryLoading ? (
            <LoadingState
              label="Loading pay history…"
              size="sm"
              layout="section"
            />
          ) : null}
          {employeeHistoryError ? (
            <p className="text-sm text-red-700">{employeeHistoryError}</p>
          ) : null}
          {!employeeHistoryLoading && !employeeHistoryError ? (
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Month</th>
                    <th className={scrollableTableThClassName}>Days to Pay</th>
                    <th className={scrollableTableThClassName}>Basic</th>
                    <th className={scrollableTableThClassName}>
                      Absence Deduction
                    </th>
                    <th className={scrollableTableThClassName}>Overtime</th>
                    <th className={scrollableTableThClassName}>Gross</th>
                    <th className={scrollableTableThClassName}>SSNIT</th>
                    <th className={scrollableTableThClassName}>PAYE</th>
                    <th className={scrollableTableThClassName}>Welfare</th>
                    <th className={scrollableTableThClassName}>Net</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {employeeHistoryLines.length === 0 ? (
                    <tr>
                      <td
                        colSpan={10}
                        className="px-4 py-6 text-center text-slate-500"
                      >
                        No locked payroll history for this employee.
                      </td>
                    </tr>
                  ) : (
                    employeeHistoryLines.map((line) => (
                      <tr key={line.id} className="text-slate-700">
                        <td className="px-4 py-3">{line.monthLabel}</td>
                        <td className="px-4 py-3">
                          <DaysToPayCell value={line.days_to_pay} />
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.basic_salary)}
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.absence_deduction)}
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.overtime_amount)}
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.gross_pay)}
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.employee_ssnit)}
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.paye_tax)}
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.welfare_deduction)}
                        </td>
                        <td className="px-4 py-3">
                          {formatGHS(line.net_pay)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ScrollableTable>
          ) : null}
        </div>
      ) : null}

      {filtersActive && filteredRows.length > 0 ? (
        <p className="text-sm font-medium text-slate-800">
          {filteredPayrollBannerLabel(filteredRows.length, rows.length)}
        </p>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Staff ID"
                  columnId="staff_id"
                  valueType="text"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableStickyFirstThClassName}>
                <PayrollSortableHeader
                  label="Full Name"
                  columnId="full_name"
                  valueType="text"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Days to Pay"
                  columnId="days_to_pay"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Basic Salary"
                  columnId="basic_salary"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Absence Deduction"
                  columnId="absence_deduction"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Overtime"
                  columnId="overtime_amount"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Gross Pay"
                  columnId="gross_pay"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Employee SSNIT"
                  columnId="employee_ssnit"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="PAYE Tax"
                  columnId="paye_tax"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Loan Repayment"
                  columnId="loan_repayment"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Total Deductions"
                  columnId="total_deductions"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <PayrollSortableHeader
                  label="Net Pay"
                  columnId="net_pay"
                  valueType="number"
                  sort={tableSort}
                  onSortChange={setTableSort}
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                  {periodOptions.length === 0
                    ? "No locked payroll history records yet."
                    : rows.length === 0
                      ? "No payroll history rows for this period."
                      : "No employees match the current filters."}
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => (
                <tr key={row.id} className="text-slate-700">
                  <td className="px-4 py-3">{row.staff_id}</td>
                  <td className={scrollableTableStickyFirstTdClassName()}>
                    {row.full_name}
                  </td>
                  <td className="px-4 py-3">
                    <DaysToPayCell value={row.days_to_pay} />
                  </td>
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
        <div className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
              Period Totals
            </h3>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <p className="text-sm text-slate-600">
                Total Gross:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(periodTotals.grossPay)}
                </span>
              </p>
              <p className="text-sm text-slate-600">
                Total Deductions:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(periodTotals.totalDeductions)}
                </span>
              </p>
              <p className="text-sm text-slate-600">
                Total Net Pay:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(periodTotals.netPay)}
                </span>
              </p>
              <p className="text-sm text-slate-600">
                Total Employer SSNIT Cost:{" "}
                <span className="font-medium text-[#0f2744]">
                  {formatGHS(periodTotals.employerSsnitCost)}
                </span>
              </p>
            </div>
          </div>
          {filtersActive ? (
            <PayrollFilteredTotalsCard filteredCount={filteredRows.length}>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <p className="text-sm text-slate-600">
                  Total Gross:{" "}
                  <span className="font-medium text-sky-950">
                    {formatGHS(filteredTotals.grossPay)}
                  </span>
                </p>
                <p className="text-sm text-slate-600">
                  Total Deductions:{" "}
                  <span className="font-medium text-sky-950">
                    {formatGHS(filteredTotals.totalDeductions)}
                  </span>
                </p>
                <p className="text-sm text-slate-600">
                  Total Net Pay:{" "}
                  <span className="font-medium text-sky-950">
                    {formatGHS(filteredTotals.netPay)}
                  </span>
                </p>
                <p className="text-sm text-slate-600">
                  Total Employer SSNIT Cost:{" "}
                  <span className="font-medium text-sky-950">
                    {formatGHS(filteredTotals.employerSsnitCost)}
                  </span>
                </p>
              </div>
            </PayrollFilteredTotalsCard>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
