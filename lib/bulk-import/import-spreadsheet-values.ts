const PG_DATE_MIN = "0001-01-01";
const PG_DATE_MAX = "5874897-12-31";

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return String(value).trim() === "";
}

function isValidCalendarDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }

  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function normalizeIsoDateParts(isoDate: string): string | null | "out_of_range" {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!isValidCalendarDateParts(year, month, day)) {
    return null;
  }

  const normalized = `${match[1]}-${match[2]}-${match[3]}`;
  if (normalized < PG_DATE_MIN || normalized > PG_DATE_MAX) {
    return "out_of_range";
  }

  return normalized;
}

function parseDayMonthYearText(trimmed: string): string | null | "invalid" | "out_of_range" {
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
  if (!dmy) {
    return null;
  }

  const day = Number(dmy[1]);
  const month = Number(dmy[2]);
  const year = Number(dmy[3]);

  if (!isValidCalendarDateParts(year, month, day)) {
    return "invalid";
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const normalized = normalizeIsoDateParts(iso);
  if (normalized === "out_of_range") {
    return "out_of_range";
  }

  return normalized ?? "invalid";
}

/** Parse spreadsheet dates for bulk import (Excel cells, ISO, DD/MM/YYYY). */
export function parseBulkImportSpreadsheetDate(
  value: unknown,
): string | null | "invalid" | "out_of_range" {
  if (isBlank(value)) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    const normalized = normalizeIsoDateParts(iso);
    if (normalized === "out_of_range") {
      return "out_of_range";
    }
    return normalized ?? "invalid";
  }

  const trimmed = String(value).trim();
  const isoMatch = normalizeIsoDateParts(trimmed);
  if (isoMatch && isoMatch !== "out_of_range") {
    return isoMatch;
  }
  if (isoMatch === "out_of_range") {
    return "out_of_range";
  }

  const dmy = parseDayMonthYearText(trimmed);
  if (dmy) {
    return dmy;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return "invalid";
  }

  const iso = parsed.toISOString().slice(0, 10);
  const normalized = normalizeIsoDateParts(iso);
  if (normalized === "out_of_range") {
    return "out_of_range";
  }

  return normalized ?? "invalid";
}

/** Commit-safe date parse (returns null when invalid). */
export function parseBulkImportDateForCommit(value: unknown): string | null {
  const parsed = parseBulkImportSpreadsheetDate(value);
  if (!parsed || parsed === "invalid" || parsed === "out_of_range") {
    return null;
  }

  return parsed;
}

export function trimBulkImportIdentifier(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  return String(value).replace(/\s+/g, " ").trim();
}
