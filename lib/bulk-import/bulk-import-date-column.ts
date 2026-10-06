import type { BulkImportType } from "@/lib/bulk-import/types";

const PG_DATE_MIN = "0001-01-01";
const PG_DATE_MAX = "5874897-12-31";

export type BulkImportDateParseResult =
  | { kind: "blank" }
  | { kind: "iso"; iso: string }
  | { kind: "invalid" }
  | { kind: "out_of_range" }
  | { kind: "column_conflict" }
  | { kind: "ambiguous"; iso: string };

export type BulkImportDateColumnMode =
  | { kind: "mdy"; ambiguousDefault: false }
  | { kind: "dmy"; ambiguousDefault: false }
  | { kind: "dmy"; ambiguousDefault: true }
  | { kind: "conflict" };

export type BulkImportDateColumnProfile = {
  fieldKey: string;
  mode: BulkImportDateColumnMode;
};

export const BULK_IMPORT_DATE_FIELDS_BY_TYPE: Record<
  BulkImportType,
  readonly string[]
> = {
  product: ["manufacturing_date", "expiration_date"],
  service: [],
  employee: [
    "date_of_birth",
    "date_hired",
    "appointment_end_date",
    "ghana_card_issue_date",
    "ghana_card_expiry_date",
  ],
  customer: ["contract_start", "contract_end"],
  expense: ["date"],
  fixed_asset: ["purchase_date"],
};

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  return String(value).trim() === "";
}

function isValidCalendarDateParts(
  year: number,
  month: number,
  day: number,
): boolean {
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

function isoFromParts(year: number, month: number, day: number): string | null | "out_of_range" {
  if (!isValidCalendarDateParts(year, month, day)) {
    return null;
  }
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return normalizeIsoDateParts(iso);
}

/** Excel empty-date placeholders → treat as blank for optional fields. */
export function isBulkImportExcelEmptyDatePlaceholder(value: unknown): boolean {
  if (isBlank(value)) {
    return true;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0 || value === 1;
  }

  const trimmed = String(value).trim();
  if (/^(0|[1-9]\d*)(\.\d+)?$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && (numeric === 0 || numeric === 1)) {
      return true;
    }
  }

  const normalized = trimmed.replace(/\s+/g, " ").toLowerCase();
  const slash = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(normalized);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    const year = Number(slash[3]);
    if (year === 1900 && ((a === 1 && b === 1) || (a === 0 && b === 1) || (a === 1 && b === 0))) {
      return true;
    }
  }

  if (/^1900-01-01$/.test(trimmed)) {
    return true;
  }

  return false;
}

export function excelSerialToIsoDate(serial: number): string | null | "out_of_range" {
  if (!Number.isFinite(serial)) {
    return null;
  }
  if (serial === 0 || serial === 1) {
    return null;
  }
  const epoch = Date.UTC(1899, 11, 30);
  const ms = epoch + Math.round(serial * 86400000);
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const iso = date.toISOString().slice(0, 10);
  const normalized = normalizeIsoDateParts(iso);
  if (normalized === "out_of_range") {
    return "out_of_range";
  }
  return normalized ?? null;
}

type SlashParts = { first: number; second: number; year: number };

function parseSlashParts(trimmed: string): SlashParts | null {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
  if (!match) {
    return null;
  }
  return {
    first: Number(match[1]),
    second: Number(match[2]),
    year: Number(match[3]),
  };
}

function slashHints(parts: SlashParts): {
  mdyOnly: boolean;
  dmyOnly: boolean;
  ambiguous: boolean;
} {
  const { first, second } = parts;
  const mdyOnly = second > 12 && first <= 12;
  const dmyOnly = first > 12 && second <= 12;
  const ambiguous = first <= 12 && second <= 12;
  return { mdyOnly, dmyOnly, ambiguous };
}

function parseSlashWithOrder(
  parts: SlashParts,
  order: "mdy" | "dmy",
): string | null | "out_of_range" {
  const month = order === "mdy" ? parts.first : parts.second;
  const day = order === "mdy" ? parts.second : parts.first;
  const iso = isoFromParts(parts.year, month, day);
  if (iso === "out_of_range") {
    return "out_of_range";
  }
  return iso;
}

function parseSlashDateValue(
  trimmed: string,
  mode: BulkImportDateColumnMode,
): BulkImportDateParseResult {
  const parts = parseSlashParts(trimmed);
  if (!parts) {
    return { kind: "invalid" };
  }

  const hints = slashHints(parts);

  if (mode.kind === "conflict") {
    const asMdy = parseSlashWithOrder(parts, "mdy");
    const asDmy = parseSlashWithOrder(parts, "dmy");
    const mdyValid = asMdy && asMdy !== "out_of_range";
    const dmyValid = asDmy && asDmy !== "out_of_range";
    if (mdyValid && dmyValid && asMdy !== asDmy) {
      return { kind: "column_conflict" };
    }
    const chosen = mdyValid ? asMdy : dmyValid ? asDmy : null;
    if (!chosen) {
      return asMdy === "out_of_range" || asDmy === "out_of_range"
        ? { kind: "out_of_range" }
        : { kind: "invalid" };
    }
    if (hints.ambiguous) {
      return { kind: "ambiguous", iso: chosen };
    }
    return { kind: "iso", iso: chosen };
  }

  const order = mode.kind === "mdy" ? "mdy" : "dmy";
  const parsed = parseSlashWithOrder(parts, order);
  if (parsed === "out_of_range") {
    return { kind: "out_of_range" };
  }
  if (!parsed) {
    return { kind: "invalid" };
  }
  if (mode.ambiguousDefault && hints.ambiguous) {
    return { kind: "ambiguous", iso: parsed };
  }
  return { kind: "iso", iso: parsed };
}

export function inferBulkImportDateColumnMode(
  values: unknown[],
): BulkImportDateColumnMode {
  let hasMdyHint = false;
  let hasDmyHint = false;

  for (const value of values) {
    if (isBlank(value) || isBulkImportExcelEmptyDatePlaceholder(value)) {
      continue;
    }
    if (value instanceof Date) {
      continue;
    }
    const trimmed = String(value).trim();
    if (normalizeIsoDateParts(trimmed)) {
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      continue;
    }
    const parts = parseSlashParts(trimmed);
    if (!parts) {
      continue;
    }
    const hints = slashHints(parts);
    if (hints.mdyOnly) {
      hasMdyHint = true;
    }
    if (hints.dmyOnly) {
      hasDmyHint = true;
    }
  }

  if (hasMdyHint && hasDmyHint) {
    return { kind: "conflict" };
  }
  if (hasMdyHint) {
    return { kind: "mdy", ambiguousDefault: false };
  }
  if (hasDmyHint) {
    return { kind: "dmy", ambiguousDefault: false };
  }
  return { kind: "dmy", ambiguousDefault: true };
}

export function buildBulkImportDateColumnProfiles(
  mappedRows: Array<Record<string, unknown>>,
  fieldKeys: readonly string[],
): Map<string, BulkImportDateColumnProfile> {
  const profiles = new Map<string, BulkImportDateColumnProfile>();
  for (const fieldKey of fieldKeys) {
    const values = mappedRows
      .filter((row) => fieldKey in row)
      .map((row) => row[fieldKey]);
    if (values.length === 0) {
      continue;
    }
    profiles.set(fieldKey, {
      fieldKey,
      mode: inferBulkImportDateColumnMode(values),
    });
  }
  return profiles;
}

export function parseBulkImportDateWithColumnProfile(
  value: unknown,
  profile: BulkImportDateColumnProfile | undefined,
  options?: { required?: boolean },
): BulkImportDateParseResult {
  const required = options?.required ?? false;

  if (isBlank(value) || isBulkImportExcelEmptyDatePlaceholder(value)) {
    if (required) {
      return { kind: "invalid" };
    }
    return { kind: "blank" };
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString().slice(0, 10);
    const normalized = normalizeIsoDateParts(iso);
    if (normalized === "out_of_range") {
      return { kind: "out_of_range" };
    }
    return normalized ? { kind: "iso", iso: normalized } : { kind: "invalid" };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const fromSerial = excelSerialToIsoDate(value);
    if (fromSerial === "out_of_range") {
      return { kind: "out_of_range" };
    }
    if (fromSerial) {
      return { kind: "iso", iso: fromSerial };
    }
    if (required) {
      return { kind: "invalid" };
    }
    return { kind: "blank" };
  }

  const trimmed = String(value).trim();
  const isoDirect = normalizeIsoDateParts(trimmed);
  if (isoDirect === "out_of_range") {
    return { kind: "out_of_range" };
  }
  if (isoDirect) {
    return { kind: "iso", iso: isoDirect };
  }

  const numericToken = trimmed.replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(numericToken)) {
    const serial = Number(numericToken);
    const fromSerial = excelSerialToIsoDate(serial);
    if (fromSerial === "out_of_range") {
      return { kind: "out_of_range" };
    }
    if (fromSerial) {
      return { kind: "iso", iso: fromSerial };
    }
  }

  const mode: BulkImportDateColumnMode =
    profile?.mode ?? { kind: "dmy", ambiguousDefault: true };

  if (parseSlashParts(trimmed)) {
    return parseSlashDateValue(trimmed, mode);
  }

  const fallback = new Date(trimmed);
  if (Number.isNaN(fallback.getTime())) {
    return { kind: "invalid" };
  }
  const iso = fallback.toISOString().slice(0, 10);
  const normalized = normalizeIsoDateParts(iso);
  if (normalized === "out_of_range") {
    return { kind: "out_of_range" };
  }
  return normalized ? { kind: "iso", iso: normalized } : { kind: "invalid" };
}

export function bulkImportDateColumnAmbiguousWarningMessage(
  columnLabel: string,
): string {
  return `Dates in ${columnLabel} were read as day/month/year (e.g. 03/04/2026 = 3 April 2026). Check before importing.`;
}

export function bulkImportDateColumnConflictMessage(columnLabel: string): string {
  return `${columnLabel} mixes US (M/D/Y) and day/month (D/M/Y) dates — use one format for the whole column or use YYYY-MM-DD.`;
}

/** Legacy single-value parse (defaults to Ghana D/M/Y for ambiguous slashes). */
export function parseBulkImportSpreadsheetDate(
  value: unknown,
): string | null | "invalid" | "out_of_range" {
  const parsed = parseBulkImportDateWithColumnProfile(value, undefined, {
    required: false,
  });
  switch (parsed.kind) {
    case "blank":
      return null;
    case "iso":
    case "ambiguous":
      return parsed.iso;
    case "out_of_range":
      return "out_of_range";
    default:
      return "invalid";
  }
}

export function parseBulkImportDateForCommit(value: unknown): string | null {
  const parsed = parseBulkImportSpreadsheetDate(value);
  if (!parsed || parsed === "invalid" || parsed === "out_of_range") {
    return null;
  }
  return parsed;
}
