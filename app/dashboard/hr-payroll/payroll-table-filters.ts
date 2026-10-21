import { matchesAttendanceTextQuery } from "./attendance-register-filters";
import { compareStaffIds } from "../employees/employee-record-utils";
import {
  blankFilterLabel,
  collectDistinctColumnValues,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
} from "../finance/register-column-filter";

/** Display-only row shape shared by Processing and History filter/sort. */
export type PayrollTableFilterableRow = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  contractLabel: string;
  siteLabel: string;
  positionLabel: string;
  employmentTypeLabel: string;
  shiftLabel: string;
  absence_deduction: number | null;
  overtime_amount: number | null;
  basic_salary: number | null;
};

export type PayrollQuickChips = {
  hasAbsence: boolean;
  hasOvertime: boolean;
  missingBasic: boolean;
};

export type PayrollTableFilters = {
  search: string;
  contract: RegisterColumnFilterValue;
  site: RegisterColumnFilterValue;
  position: RegisterColumnFilterValue;
  employmentType: RegisterColumnFilterValue;
  shift: RegisterColumnFilterValue;
  chips: PayrollQuickChips;
};

export const EMPTY_PAYROLL_TABLE_FILTERS: PayrollTableFilters = {
  search: "",
  contract: null,
  site: null,
  position: null,
  employmentType: null,
  shift: null,
  chips: {
    hasAbsence: false,
    hasOvertime: false,
    missingBasic: false,
  },
};

export function defaultPayrollTableSort(): RegisterColumnSortState {
  return { columnId: "staff_id", direction: "asc", valueType: "text" };
}

export function payrollTableFiltersActive(filters: PayrollTableFilters): boolean {
  if (filters.search.trim()) return true;
  if (filters.chips.hasAbsence || filters.chips.hasOvertime || filters.chips.missingBasic) {
    return true;
  }
  return [
    filters.contract,
    filters.site,
    filters.position,
    filters.employmentType,
    filters.shift,
  ].some((filter) => filter !== null);
}

function passesSet(
  value: string,
  filter: RegisterColumnFilterValue,
): boolean {
  if (!filter) return true;
  return filter.has(value);
}

export function filterPayrollTableRows<T extends PayrollTableFilterableRow>(
  rows: T[],
  filters: PayrollTableFilters,
): T[] {
  const search = filters.search.trim();
  return rows.filter((row) => {
    if (
      search &&
      !matchesAttendanceTextQuery(search, row.full_name, row.staff_id)
    ) {
      return false;
    }
    if (!passesSet(row.contractLabel, filters.contract)) return false;
    if (!passesSet(row.siteLabel, filters.site)) return false;
    if (!passesSet(row.positionLabel, filters.position)) return false;
    if (!passesSet(row.employmentTypeLabel, filters.employmentType)) {
      return false;
    }
    if (!passesSet(row.shiftLabel, filters.shift)) return false;
    if (filters.chips.hasAbsence && !(Number(row.absence_deduction) > 0)) {
      return false;
    }
    if (filters.chips.hasOvertime && !(Number(row.overtime_amount) > 0)) {
      return false;
    }
    if (filters.chips.missingBasic && Number(row.basic_salary) > 0) {
      return false;
    }
    return true;
  });
}

export function sortPayrollTableRows<T extends PayrollTableFilterableRow>(
  rows: T[],
  sort: RegisterColumnSortState | null,
  getExtra?: (row: T, columnId: string) => unknown,
): T[] {
  const active = sort ?? defaultPayrollTableSort();
  const direction = active.direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    let cmp = 0;
    switch (active.columnId) {
      case "staff_id":
        cmp = compareStaffIds(left.staff_id, right.staff_id);
        break;
      case "full_name":
        cmp = left.full_name.localeCompare(right.full_name, undefined, {
          sensitivity: "base",
        });
        break;
      case "contract":
        cmp = left.contractLabel.localeCompare(right.contractLabel, undefined, {
          sensitivity: "base",
        });
        break;
      case "site":
        cmp = left.siteLabel.localeCompare(right.siteLabel, undefined, {
          sensitivity: "base",
        });
        break;
      case "position":
        cmp = left.positionLabel.localeCompare(right.positionLabel, undefined, {
          sensitivity: "base",
        });
        break;
      case "employment_type":
        cmp = left.employmentTypeLabel.localeCompare(
          right.employmentTypeLabel,
          undefined,
          { sensitivity: "base" },
        );
        break;
      case "shift":
        cmp = left.shiftLabel.localeCompare(right.shiftLabel, undefined, {
          sensitivity: "base",
        });
        break;
      default: {
        const leftExtra = getExtra?.(left, active.columnId);
        const rightExtra = getExtra?.(right, active.columnId);
        if (active.valueType === "number") {
          cmp =
            (Number(leftExtra) || 0) - (Number(rightExtra) || 0);
        } else {
          cmp = String(leftExtra ?? "").localeCompare(
            String(rightExtra ?? ""),
            undefined,
            { sensitivity: "base" },
          );
        }
        break;
      }
    }
    if (cmp !== 0) {
      return cmp * direction;
    }
    return compareStaffIds(left.staff_id, right.staff_id);
  });
}

export function collectPayrollFilterOptions(
  rows: PayrollTableFilterableRow[],
): {
  contract: string[];
  site: string[];
  position: string[];
  employmentType: string[];
  shift: string[];
} {
  return {
    contract: collectDistinctColumnValues(rows.map((row) => row.contractLabel)),
    site: collectDistinctColumnValues(rows.map((row) => row.siteLabel)),
    position: collectDistinctColumnValues(rows.map((row) => row.positionLabel)),
    employmentType: collectDistinctColumnValues(
      rows.map((row) => row.employmentTypeLabel),
    ),
    shift: collectDistinctColumnValues(rows.map((row) => row.shiftLabel)),
  };
}

export function enrichPayrollFilterLabels(input: {
  contractProject: string | null | undefined;
  projectContract: string | null | undefined;
  siteCode: string | null | undefined;
  siteNameByCode: Map<string, string>;
  position: string | null | undefined;
  employmentType: string | null | undefined;
  shift: string | null | undefined;
}): Pick<
  PayrollTableFilterableRow,
  | "contractLabel"
  | "siteLabel"
  | "positionLabel"
  | "employmentTypeLabel"
  | "shiftLabel"
> {
  const contract =
    input.projectContract?.trim() ||
    input.contractProject?.trim() ||
    "";
  const siteCode = input.siteCode?.trim() || "";
  const siteName = siteCode
    ? input.siteNameByCode.get(siteCode) ?? siteCode
    : "";
  return {
    contractLabel: blankFilterLabel(contract),
    siteLabel: blankFilterLabel(siteName),
    positionLabel: blankFilterLabel(input.position),
    employmentTypeLabel: blankFilterLabel(input.employmentType),
    shiftLabel: blankFilterLabel(input.shift),
  };
}

export type PayrollMoneyTotals = {
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  employerSsnitCost: number;
  employeeSsnit: number;
  employerSsnit: number;
  tier2: number;
  payeTax: number;
};

export function sumPayrollMoneyTotals<
  T extends {
    gross_pay: number | null;
    total_deductions: number | null;
    net_pay: number | null;
    employer_ssnit: number | null;
    tier2: number | null;
    employee_ssnit?: number | null;
    paye_tax?: number | null;
  },
>(rows: T[]): PayrollMoneyTotals {
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
      employeeSsnit:
        accumulator.employeeSsnit + (Number(row.employee_ssnit) || 0),
      employerSsnit:
        accumulator.employerSsnit + (Number(row.employer_ssnit) || 0),
      tier2: accumulator.tier2 + (Number(row.tier2) || 0),
      payeTax: accumulator.payeTax + (Number(row.paye_tax) || 0),
    }),
    {
      grossPay: 0,
      totalDeductions: 0,
      netPay: 0,
      employerSsnitCost: 0,
      employeeSsnit: 0,
      employerSsnit: 0,
      tier2: 0,
      payeTax: 0,
    },
  );
}

function encodeFilterSet(filter: RegisterColumnFilterValue): string | null {
  if (!filter || filter.size === 0) return null;
  return [...filter].join("|");
}

function decodeFilterSet(raw: string | null): RegisterColumnFilterValue {
  if (!raw?.trim()) return null;
  const values = raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
}

export function payrollFiltersToSearchParams(
  periodKey: string,
  filters: PayrollTableFilters,
  sort: RegisterColumnSortState | null,
): URLSearchParams {
  const params = new URLSearchParams();
  if (periodKey) params.set("period", periodKey);
  if (filters.search.trim()) params.set("q", filters.search.trim());
  const contract = encodeFilterSet(filters.contract);
  if (contract) params.set("contract", contract);
  const site = encodeFilterSet(filters.site);
  if (site) params.set("site", site);
  const position = encodeFilterSet(filters.position);
  if (position) params.set("position", position);
  const empType = encodeFilterSet(filters.employmentType);
  if (empType) params.set("empType", empType);
  const shift = encodeFilterSet(filters.shift);
  if (shift) params.set("shift", shift);
  if (filters.chips.hasAbsence) params.set("absence", "1");
  if (filters.chips.hasOvertime) params.set("ot", "1");
  if (filters.chips.missingBasic) params.set("missingBasic", "1");
  const active = sort ?? defaultPayrollTableSort();
  if (!(active.columnId === "staff_id" && active.direction === "asc")) {
    params.set("sort", `${active.columnId}:${active.direction}`);
  }
  return params;
}

export function payrollFiltersFromSearchParams(params: URLSearchParams): {
  period: string | null;
  filters: PayrollTableFilters;
  sort: RegisterColumnSortState | null;
} {
  let sort: RegisterColumnSortState | null = null;
  const sortRaw = params.get("sort")?.trim();
  if (sortRaw) {
    const [columnId, direction] = sortRaw.split(":");
    if (columnId && (direction === "asc" || direction === "desc")) {
      sort = {
        columnId,
        direction,
        valueType:
          columnId === "staff_id" ||
          columnId === "full_name" ||
          columnId === "contract" ||
          columnId === "site" ||
          columnId === "position" ||
          columnId === "employment_type" ||
          columnId === "shift" ||
          columnId === "payment_method" ||
          columnId === "momo_name"
            ? "text"
            : "number",
      };
    }
  }

  return {
    period: params.get("period")?.trim() || null,
    filters: {
      search: params.get("q") ?? "",
      contract: decodeFilterSet(params.get("contract")),
      site: decodeFilterSet(params.get("site")),
      position: decodeFilterSet(params.get("position")),
      employmentType: decodeFilterSet(params.get("empType")),
      shift: decodeFilterSet(params.get("shift")),
      chips: {
        hasAbsence: params.get("absence") === "1",
        hasOvertime: params.get("ot") === "1",
        missingBasic: params.get("missingBasic") === "1",
      },
    },
    sort,
  };
}

export function filteredPayrollBannerLabel(
  filteredCount: number,
  totalCount: number,
): string {
  return `Filtered: ${filteredCount} of ${totalCount} employees`;
}

export function lockPeriodFilterConfirmSuffix(
  filteredCount: number,
  totalCount: number,
): string {
  return ` This locks all ${totalCount} employees, not just the ${filteredCount} shown.`;
}
