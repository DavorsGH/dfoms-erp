import * as XLSX from "xlsx";
import {
  DEFAULT_ATTENDANCE_STATUS,
  type AttendanceRegisterEntry,
} from "./attendance-register-utils";
import { getEmployeeByStaffId, type HrEmployee } from "./employee-utils";
import { calculateHoursFromClock } from "./hr-register-utils";

export type AttendanceImportInsertPayload = {
  date: string;
  staff_id: string;
  employment_type: string | null;
  project_assignment: string | null;
  clock_in: string | null;
  clock_out: string | null;
  hours_worked: number | null;
  overtime_hours: number | null;
  attendance_status: string;
};

export type RawAttendanceImportRow = {
  rowNumber: number;
  dateRaw: unknown;
  staffIdRaw: unknown;
  clockInRaw: unknown;
  clockOutRaw: unknown;
  hoursWorkedRaw: unknown;
  overtimeHoursRaw: unknown;
  attendanceStatusRaw: unknown;
};

export type ImportRowCategory = "ready" | "duplicate" | "error";

export type ClassifiedAttendanceImportRow = {
  rowNumber: number;
  category: ImportRowCategory;
  message: string;
  staffId: string;
  dateLabel: string;
  employeeName: string | null;
  payload: AttendanceImportInsertPayload | null;
};

export type AttendanceImportPreview = {
  ready: ClassifiedAttendanceImportRow[];
  duplicates: ClassifiedAttendanceImportRow[];
  errors: ClassifiedAttendanceImportRow[];
};

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function formatIsoDate(year: number, month: number, day: number): string | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function normalizeYear(value: number): number {
  if (value >= 100) {
    return value;
  }

  return value >= 70 ? 1900 + value : 2000 + value;
}

export function parseImportDate(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatIsoDate(
      value.getFullYear(),
      value.getMonth() + 1,
      value.getDate(),
    );
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return formatIsoDate(parsed.y, parsed.m, parsed.d);
    }
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [year, month, day] = trimmed.split("-").map(Number);
    return formatIsoDate(year, month, day);
  }

  const dmyTextMatch =
    /^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{2,4})$/i.exec(trimmed);
  if (dmyTextMatch) {
    const day = Number(dmyTextMatch[1]);
    const month = MONTH_ABBREVIATIONS[dmyTextMatch[2].toLowerCase()];
    const year = normalizeYear(Number(dmyTextMatch[3]));
    if (month) {
      return formatIsoDate(year, month, day);
    }
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(trimmed);
  if (slashMatch) {
    const month = Number(slashMatch[1]);
    const day = Number(slashMatch[2]);
    const year = normalizeYear(Number(slashMatch[3]));
    return formatIsoDate(year, month, day);
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return formatIsoDate(
      parsed.getFullYear(),
      parsed.getMonth() + 1,
      parsed.getDate(),
    );
  }

  return null;
}

export function parseImportTime(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
  }

  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${pad2(hours)}:${pad2(minutes)}`;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return `${pad2(hours)}:${pad2(minutes)}`;
}

function parseOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function isBlankImportRow(row: unknown[]): boolean {
  const meaningfulIndexes = [0, 1, 5, 6, 7, 8, 9];
  return meaningfulIndexes.every((index) => String(row[index] ?? "").trim() === "");
}

function isHeaderRow(row: unknown[]): boolean {
  const dateHeader = String(row[0] ?? "")
    .trim()
    .toLowerCase();
  const staffHeader = String(row[1] ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return dateHeader === "date" && staffHeader === "staff id";
}

function rowToRawImportRow(
  row: unknown[],
  rowNumber: number,
): RawAttendanceImportRow {
  return {
    rowNumber,
    dateRaw: row[0],
    staffIdRaw: row[1],
    clockInRaw: row[5],
    clockOutRaw: row[6],
    hoursWorkedRaw: row[7],
    overtimeHoursRaw: row[8],
    attendanceStatusRaw: row[9],
  };
}

export function parseAttendanceSpreadsheetRows(rows: unknown[][]): RawAttendanceImportRow[] {
  const parsedRows: RawAttendanceImportRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;

    if (!Array.isArray(row) || isBlankImportRow(row)) {
      return;
    }

    if (index === 0 && isHeaderRow(row)) {
      return;
    }

    parsedRows.push(rowToRawImportRow(row, rowNumber));
  });

  return parsedRows;
}

export async function readAttendanceImportFile(
  file: File,
): Promise<RawAttendanceImportRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    const text = await file.text();
    const workbook = XLSX.read(text, { type: "string" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];

    return parseAttendanceSpreadsheetRows(rows);
  }

  if (extension === "xlsx") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];

    return parseAttendanceSpreadsheetRows(rows);
  }

  throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
}

function buildAttendancePayload(
  raw: RawAttendanceImportRow,
  employee: HrEmployee,
): AttendanceImportInsertPayload | null {
  const date = parseImportDate(raw.dateRaw);
  const staffId = String(raw.staffIdRaw ?? "").trim();

  if (!date || !staffId) {
    return null;
  }

  const clockIn = parseImportTime(raw.clockInRaw);
  const clockOut = parseImportTime(raw.clockOutRaw);
  const hoursFromFile = parseOptionalNumber(raw.hoursWorkedRaw);
  const hoursWorked =
    hoursFromFile ??
    (clockIn && clockOut ? calculateHoursFromClock(clockIn, clockOut) : null);
  const overtimeHours = parseOptionalNumber(raw.overtimeHoursRaw);
  const statusRaw = String(raw.attendanceStatusRaw ?? "").trim();
  const attendanceStatus = statusRaw || DEFAULT_ATTENDANCE_STATUS;

  return {
    date,
    staff_id: staffId,
    employment_type: employee.employment_type ?? null,
    project_assignment: employee.contract_project ?? null,
    clock_in: clockIn,
    clock_out: clockOut,
    hours_worked: hoursWorked,
    overtime_hours: overtimeHours,
    attendance_status: attendanceStatus,
  };
}

function existingEntryKey(date: string, staffId: string): string {
  return `${date}|${staffId}`;
}

export function classifyAttendanceImportRows(
  rawRows: RawAttendanceImportRow[],
  employees: HrEmployee[],
  existingEntries: Pick<AttendanceRegisterEntry, "date" | "staff_id">[],
): AttendanceImportPreview {
  const existingKeys = new Set(
    existingEntries.map((entry) =>
      existingEntryKey(entry.date.slice(0, 10), entry.staff_id),
    ),
  );
  const seenImportKeys = new Set<string>();

  const ready: ClassifiedAttendanceImportRow[] = [];
  const duplicates: ClassifiedAttendanceImportRow[] = [];
  const errors: ClassifiedAttendanceImportRow[] = [];

  for (const raw of rawRows) {
    const staffId = String(raw.staffIdRaw ?? "").trim();
    const date = parseImportDate(raw.dateRaw);
    const dateLabel =
      date ?? (String(raw.dateRaw ?? "").trim() || "Invalid date");
    const employee = staffId ? getEmployeeByStaffId(employees, staffId) : undefined;

    if (!staffId) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Staff ID is required",
        staffId: "—",
        dateLabel,
        employeeName: null,
        payload: null,
      });
      continue;
    }

    if (!date) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Invalid date "${String(raw.dateRaw ?? "").trim()}"`,
        staffId,
        dateLabel,
        employeeName: employee?.full_name ?? null,
        payload: null,
      });
      continue;
    }

    if (!employee) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Staff ID "${staffId}" not found`,
        staffId,
        dateLabel,
        employeeName: null,
        payload: null,
      });
      continue;
    }

    const payload = buildAttendancePayload(raw, employee);
    if (!payload) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Invalid time, hours, or attendance status value",
        staffId,
        dateLabel,
        employeeName: employee.full_name,
        payload: null,
      });
      continue;
    }

    const key = existingEntryKey(payload.date, payload.staff_id);
    if (existingKeys.has(key) || seenImportKeys.has(key)) {
      duplicates.push({
        rowNumber: raw.rowNumber,
        category: "duplicate",
        message: existingKeys.has(key)
          ? "Already exists in attendance register, will be skipped"
          : "Duplicate row in file, will be skipped",
        staffId,
        dateLabel,
        employeeName: employee.full_name,
        payload,
      });
      continue;
    }

    seenImportKeys.add(key);
    ready.push({
      rowNumber: raw.rowNumber,
      category: "ready",
      message: "Ready to import",
      staffId,
      dateLabel,
      employeeName: employee.full_name,
      payload,
    });
  }

  return { ready, duplicates, errors };
}

export function summarizeAttendanceImportPreview(
  preview: AttendanceImportPreview,
): string {
  return `${preview.ready.length} row${preview.ready.length === 1 ? "" : "s"} ready to import, ${preview.duplicates.length} row${preview.duplicates.length === 1 ? "" : "s"} will be skipped (duplicates), ${preview.errors.length} row${preview.errors.length === 1 ? "" : "s"} have errors (invalid Staff ID or invalid values)`;
}
