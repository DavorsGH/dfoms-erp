import { exceptionDecisionLabel } from "@/lib/attendance-exception-decision";
import { attendanceExceptionBadges } from "@/lib/shift-attendance";
import { pluraliseWord } from "@/utils/pluralise";
import {
  absenceDaysForAttendanceRow,
} from "./payroll-processing-utils";
import { isActiveEmployee, type HrEmployee } from "./employee-utils";
import {
  ATTENDANCE_MONTH_OPTIONS,
  type AttendanceRegisterEntry,
} from "./attendance-register-utils";
import {
  blankFilterLabel,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
  type RegisterDateRangeFilterValue,
  createRegisterDateSortState,
} from "../finance/register-column-filter";

/** Case-insensitive partial match used by register search and exceptions filter. */
export function matchesAttendanceTextQuery(
  query: string,
  ...fields: Array<string | null | undefined>
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return true;
  }
  return fields.some((field) =>
    (field ?? "").toLowerCase().includes(needle),
  );
}

export function attendanceEmployeeLabel(
  fullName: string | null | undefined,
  staffId: string,
): string {
  const name = fullName?.trim() || "Unnamed";
  return `${name} (${staffId})`;
}

export function attendanceRegisterStatusLabel(
  entry: Pick<AttendanceRegisterEntry, "attendance_status" | "source">,
): string {
  const source = (entry.source ?? "").trim().toLowerCase();
  if (source === "remote") {
    return "Remote";
  }
  return blankFilterLabel(entry.attendance_status);
}

export function attendanceRegisterDecisionLabel(
  exceptionStatus: string | null | undefined,
): string {
  return exceptionDecisionLabel(exceptionStatus);
}

export type AttendanceRegisterDisplayRow = AttendanceRegisterEntry & {
  employeeName: string;
  employeeLabel: string;
  siteLabel: string;
  shiftLabel: string;
  contractLabel: string;
  employmentTypeLabel: string;
  exceptionLabel: string;
  statusLabel: string;
  decisionLabel: string;
  isFormerStaff: boolean;
  pendingSync?: boolean;
  queueFailed?: boolean;
  queueError?: string | null;
};

/** 2 d.p. max, trailing zeros trimmed (1.25, 8.5, 142). */
export function formatAttendanceRegisterHours(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }
  return String(rounded);
}

export function buildAttendanceEmployeeFilterOptions(
  employees: HrEmployee[],
): string[] {
  const active: string[] = [];
  const former: string[] = [];
  for (const employee of employees) {
    const label = attendanceEmployeeLabel(employee.full_name, employee.staff_id);
    if (isActiveEmployee(employee)) {
      active.push(label);
    } else {
      former.push(label);
    }
  }
  active.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  former.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  if (former.length === 0) {
    return active;
  }
  return [...active, "—— Former staff ——", ...former];
}

/** Synthetic section header in the Employee filter — never matches a row. */
export const FORMER_STAFF_FILTER_SEPARATOR = "—— Former staff ——";

export function enrichAttendanceRegisterRows(input: {
  entries: AttendanceRegisterEntry[];
  employeesByStaffId: Map<string, HrEmployee>;
  siteNameByCode: Map<string, string>;
}): AttendanceRegisterDisplayRow[] {
  return input.entries.map((entry) => {
    const employee = input.employeesByStaffId.get(entry.staff_id);
    const siteCode =
      entry.site_code?.trim() || employee?.assigned_site_id?.trim() || "";
    const siteLabel = siteCode
      ? input.siteNameByCode.get(siteCode) ?? siteCode
      : "";
    const employeeName = employee?.full_name?.trim() || "";
    const exceptionBadges = attendanceExceptionBadges(entry);
    return {
      ...entry,
      employeeName: employeeName || entry.staff_id,
      employeeLabel: attendanceEmployeeLabel(
        employeeName || null,
        entry.staff_id,
      ),
      siteLabel: blankFilterLabel(siteLabel),
      shiftLabel: blankFilterLabel(entry.scheduled_shift),
      contractLabel: blankFilterLabel(entry.project_assignment),
      employmentTypeLabel: blankFilterLabel(entry.employment_type),
      exceptionLabel: blankFilterLabel(
        exceptionBadges.length > 0 ? exceptionBadges.join(" · ") : "",
      ),
      statusLabel: attendanceRegisterStatusLabel(entry),
      decisionLabel: attendanceRegisterDecisionLabel(entry.exception_status),
      isFormerStaff: employee ? !isActiveEmployee(employee) : false,
    };
  });
}

export type AttendanceRegisterFilters = {
  search: string;
  employee: RegisterColumnFilterValue;
  contract: RegisterColumnFilterValue;
  site: RegisterColumnFilterValue;
  shift: RegisterColumnFilterValue;
  employmentType: RegisterColumnFilterValue;
  status: RegisterColumnFilterValue;
  decision: RegisterColumnFilterValue;
  dateRange: RegisterDateRangeFilterValue;
};

export const EMPTY_ATTENDANCE_REGISTER_FILTERS: AttendanceRegisterFilters = {
  search: "",
  employee: null,
  contract: null,
  site: null,
  shift: null,
  employmentType: null,
  status: null,
  decision: null,
  dateRange: null,
};

export function attendanceRegisterFiltersActive(
  filters: AttendanceRegisterFilters,
): boolean {
  if (filters.search.trim()) {
    return true;
  }
  if (filters.dateRange && (filters.dateRange.from || filters.dateRange.to)) {
    return true;
  }
  return [
    filters.employee,
    filters.contract,
    filters.site,
    filters.shift,
    filters.employmentType,
    filters.status,
    filters.decision,
  ].some((filter) => filter !== null);
}

function passesSetFilter(
  value: string,
  filter: RegisterColumnFilterValue,
): boolean {
  if (!filter) {
    return true;
  }
  return filter.has(value);
}

export function filterAttendanceRegisterRows(
  rows: AttendanceRegisterDisplayRow[],
  filters: AttendanceRegisterFilters,
): AttendanceRegisterDisplayRow[] {
  const search = filters.search.trim();
  return rows.filter((row) => {
    if (
      search &&
      !matchesAttendanceTextQuery(search, row.employeeName, row.staff_id)
    ) {
      return false;
    }
    if (filters.dateRange) {
      const date = row.date.slice(0, 10);
      const from = filters.dateRange.from;
      const to = filters.dateRange.to;
      if (from && date < from) {
        return false;
      }
      if (to && date > to) {
        return false;
      }
    }
    if (!passesSetFilter(row.employeeLabel, filters.employee)) {
      return false;
    }
    if (!passesSetFilter(row.contractLabel, filters.contract)) {
      return false;
    }
    if (!passesSetFilter(row.siteLabel, filters.site)) {
      return false;
    }
    if (!passesSetFilter(row.shiftLabel, filters.shift)) {
      return false;
    }
    if (!passesSetFilter(row.employmentTypeLabel, filters.employmentType)) {
      return false;
    }
    if (!passesSetFilter(row.statusLabel, filters.status)) {
      return false;
    }
    if (!passesSetFilter(row.decisionLabel, filters.decision)) {
      return false;
    }
    return true;
  });
}

export function defaultAttendanceRegisterSort(): RegisterColumnSortState {
  return createRegisterDateSortState("date", "desc");
}

export function sortAttendanceRegisterRows(
  rows: AttendanceRegisterDisplayRow[],
  sort: RegisterColumnSortState | null,
): AttendanceRegisterDisplayRow[] {
  const active = sort ?? defaultAttendanceRegisterSort();
  const direction = active.direction === "asc" ? 1 : -1;

  return [...rows].sort((left, right) => {
    let cmp = 0;
    switch (active.columnId) {
      case "date":
        cmp = left.date.localeCompare(right.date);
        break;
      case "employee":
        cmp = left.employeeName.localeCompare(right.employeeName, undefined, {
          sensitivity: "base",
        });
        break;
      case "staff_id":
        cmp = left.staff_id.localeCompare(right.staff_id, undefined, {
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
      case "shift":
        cmp = left.shiftLabel.localeCompare(right.shiftLabel, undefined, {
          sensitivity: "base",
        });
        break;
      case "clock_in":
        cmp = (left.clock_in ?? "").localeCompare(right.clock_in ?? "");
        break;
      case "clock_out":
        cmp = (left.clock_out ?? "").localeCompare(right.clock_out ?? "");
        break;
      case "hours_worked":
        cmp = (left.hours_worked ?? -1) - (right.hours_worked ?? -1);
        break;
      case "exception":
        cmp = left.exceptionLabel.localeCompare(right.exceptionLabel, undefined, {
          sensitivity: "base",
        });
        break;
      case "status":
        cmp = left.statusLabel.localeCompare(right.statusLabel, undefined, {
          sensitivity: "base",
        });
        break;
      case "decision":
        cmp = left.decisionLabel.localeCompare(right.decisionLabel, undefined, {
          sensitivity: "base",
        });
        break;
      default:
        cmp = left.date.localeCompare(right.date);
    }
    if (cmp !== 0) {
      return cmp * direction;
    }
    // Default secondary: newest date, then employee name.
    if (active.columnId !== "date") {
      const dateCmp = right.date.localeCompare(left.date);
      if (dateCmp !== 0) {
        return dateCmp;
      }
    }
    if (active.columnId !== "employee") {
      const nameCmp = left.employeeName.localeCompare(
        right.employeeName,
        undefined,
        { sensitivity: "base" },
      );
      if (nameCmp !== 0) {
        return nameCmp;
      }
    }
    return left.staff_id.localeCompare(right.staff_id);
  });
}

/**
 * One-person month summary. Each row is classified once (payroll-style):
 * absent decision/status → absent; half_day → half day; remote source → remote;
 * late → late; present → present. Leave is omitted from these buckets.
 */
export type AttendancePersonMonthSummary = {
  staffId: string;
  fullName: string;
  monthLabel: string;
  present: number;
  late: number;
  halfDay: number;
  absent: number;
  remote: number;
  hours: number;
  summaryLine: string;
};

export function monthLabelForAttendance(year: number, month: number): string {
  const option = ATTENDANCE_MONTH_OPTIONS.find((row) => row.value === month);
  return `${option?.label ?? month} ${year}`;
}

export function classifyAttendanceRowBucket(
  row: Pick<
    AttendanceRegisterEntry,
    "attendance_status" | "exception_status" | "source"
  >,
): "present" | "late" | "half_day" | "absent" | "remote" | "leave" | "other" {
  const status = (row.attendance_status ?? "").trim().toLowerCase();
  if (
    status === "on leave" ||
    status === "leave" ||
    status.includes("leave") ||
    status === "holiday"
  ) {
    return "leave";
  }

  const absenceDays = absenceDaysForAttendanceRow(row);
  if (absenceDays >= 1) {
    return "absent";
  }
  if (absenceDays === 0.5 || row.exception_status === "half_day") {
    return "half_day";
  }

  const source = (row.source ?? "").trim().toLowerCase();
  if (source === "remote") {
    return "remote";
  }
  if (status === "late") {
    return "late";
  }
  if (status === "present") {
    return "present";
  }
  return "other";
}

export function buildAttendancePersonMonthSummary(
  rows: AttendanceRegisterDisplayRow[],
  year: number,
  month: number,
): AttendancePersonMonthSummary | null {
  const staffIds = new Set(rows.map((row) => row.staff_id));
  if (staffIds.size !== 1) {
    return null;
  }
  const staffId = [...staffIds][0]!;
  const fullName = rows[0]?.employeeName ?? staffId;
  let present = 0;
  let late = 0;
  let halfDay = 0;
  let absent = 0;
  let remote = 0;
  let hours = 0;

  for (const row of rows) {
    hours += Number(row.hours_worked) || 0;
    const bucket = classifyAttendanceRowBucket(row);
    switch (bucket) {
      case "present":
        present += 1;
        break;
      case "late":
        late += 1;
        break;
      case "half_day":
        halfDay += 1;
        break;
      case "absent":
        absent += 1;
        break;
      case "remote":
        remote += 1;
        break;
      default:
        break;
    }
  }

  const hoursRounded = Math.round(hours * 100) / 100;
  const hoursText = formatAttendanceRegisterHours(hoursRounded);
  const hoursUnit = hoursRounded === 1 ? "hour" : pluraliseWord("hour");
  const monthLabel = monthLabelForAttendance(year, month);
  const summaryLine = `${fullName} — ${monthLabel}: ${present} present · ${late} late · ${halfDay} half day · ${absent} absent · ${remote} remote · ${hoursText} ${hoursUnit}`;

  return {
    staffId,
    fullName,
    monthLabel,
    present,
    late,
    halfDay,
    absent,
    remote,
    hours: hoursRounded,
    summaryLine,
  };
}

function encodeFilterSet(filter: RegisterColumnFilterValue): string | null {
  if (!filter || filter.size === 0) {
    return null;
  }
  return [...filter].join("|");
}

function decodeFilterSet(raw: string | null): RegisterColumnFilterValue {
  if (!raw?.trim()) {
    return null;
  }
  const values = raw
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== FORMER_STAFF_FILTER_SEPARATOR);
  return values.length > 0 ? new Set(values) : null;
}

export function attendanceFiltersToSearchParams(
  year: number,
  month: number,
  filters: AttendanceRegisterFilters,
  sort: RegisterColumnSortState | null,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("year", String(year));
  params.set("month", String(month));
  if (filters.search.trim()) {
    params.set("q", filters.search.trim());
  }
  const emp = encodeFilterSet(filters.employee);
  if (emp) params.set("employee", emp);
  const contract = encodeFilterSet(filters.contract);
  if (contract) params.set("contract", contract);
  const site = encodeFilterSet(filters.site);
  if (site) params.set("site", site);
  const shift = encodeFilterSet(filters.shift);
  if (shift) params.set("shift", shift);
  const employmentType = encodeFilterSet(filters.employmentType);
  if (employmentType) params.set("empType", employmentType);
  const status = encodeFilterSet(filters.status);
  if (status) params.set("status", status);
  const decision = encodeFilterSet(filters.decision);
  if (decision) params.set("decision", decision);
  if (filters.dateRange?.from) params.set("dateFrom", filters.dateRange.from);
  if (filters.dateRange?.to) params.set("dateTo", filters.dateRange.to);
  if (sort && !(sort.columnId === "date" && sort.direction === "desc")) {
    params.set("sort", `${sort.columnId}:${sort.direction}`);
  }
  return params;
}

export function attendanceFiltersFromSearchParams(
  params: URLSearchParams,
): {
  year: number | null;
  month: number | null;
  filters: AttendanceRegisterFilters;
  sort: RegisterColumnSortState | null;
} {
  const yearRaw = Number(params.get("year"));
  const monthRaw = Number(params.get("month"));
  const year =
    Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100
      ? yearRaw
      : null;
  const month =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12
      ? monthRaw
      : null;

  const dateFrom = params.get("dateFrom")?.trim() ?? "";
  const dateTo = params.get("dateTo")?.trim() ?? "";
  const dateRange: RegisterDateRangeFilterValue =
    dateFrom || dateTo ? { from: dateFrom, to: dateTo } : null;

  let sort: RegisterColumnSortState | null = null;
  const sortRaw = params.get("sort")?.trim();
  if (sortRaw) {
    const [columnId, direction] = sortRaw.split(":");
    if (
      columnId &&
      (direction === "asc" || direction === "desc")
    ) {
      sort = {
        columnId,
        direction,
        valueType:
          columnId === "date"
            ? "date"
            : columnId === "hours_worked" || columnId === "overtime_hours"
              ? "number"
              : "text",
      };
    }
  }

  return {
    year,
    month,
    filters: {
      search: params.get("q") ?? "",
      employee: decodeFilterSet(params.get("employee")),
      contract: decodeFilterSet(params.get("contract")),
      site: decodeFilterSet(params.get("site")),
      shift: decodeFilterSet(params.get("shift")),
      employmentType: decodeFilterSet(params.get("empType")),
      status: decodeFilterSet(params.get("status")),
      decision: decodeFilterSet(params.get("decision")),
      dateRange,
    },
    sort,
  };
}

export function payrollProcessingHrefForMonth(
  year: number,
  month: number,
): string {
  const period = `${year}-${String(month).padStart(2, "0")}`;
  return `/dashboard/hr-payroll/payroll-processing?period=${period}`;
}

export function buildAttendanceRegisterCsvRows(
  rows: AttendanceRegisterDisplayRow[],
): Array<Array<string | number | null>> {
  return rows.map((row) => [
    row.date.slice(0, 10),
    row.employeeName,
    row.staff_id,
    row.employmentTypeLabel === "(Blank)" ? "" : row.employmentTypeLabel,
    row.contractLabel === "(Blank)" ? "" : row.contractLabel,
    row.siteLabel === "(Blank)" ? "" : row.siteLabel,
    row.shiftLabel === "(Blank)" ? "" : row.shiftLabel,
    row.clock_in ?? "",
    row.clock_out ?? "",
    row.hours_worked,
    row.exceptionLabel === "(Blank)" ? "" : row.exceptionLabel,
    row.statusLabel,
    row.decisionLabel,
  ]);
}

/** Same column titles as the on-screen / print table (without Actions). */
export const ATTENDANCE_REGISTER_CSV_HEADERS = [
  "Date",
  "Employee",
  "Staff ID",
  "Employment Type",
  "Contract",
  "Site",
  "Shift",
  "Clock-in",
  "Clock-out",
  "Hours",
  "Exception",
  "Status",
  "Decision",
] as const;
