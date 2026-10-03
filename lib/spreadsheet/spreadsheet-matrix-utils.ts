import {
  spreadsheetTooManyDataRowsError,
} from "@/lib/spreadsheet/spreadsheet-validation-error";
import { SPREADSHEET_UPLOAD_MAX_ROWS } from "@/lib/spreadsheet/spreadsheet-upload-validation";

/** Max physical rows SheetJS will read per sheet (formatted empty rows included). */
export const SPREADSHEET_MAX_SCAN_ROWS = 200_000;

export const SPREADSHEET_READ_HARDENING = {
  cellFormula: false,
  cellHTML: false,
  cellStyles: false,
  sheetRows: SPREADSHEET_MAX_SCAN_ROWS,
} as const;

export function isSpreadsheetPlaceholderCell(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  if (value instanceof Date) {
    return false;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0;
  }

  const text = String(value).trim();
  if (text === "") {
    return true;
  }

  const lower = text.toLowerCase();
  if (text === "-" || text === "—" || lower === "n/a" || lower === "na") {
    return true;
  }

  const normalizedNumber = text.replace(/,/g, "");
  if (/^0+(\.0+)?$/.test(normalizedNumber)) {
    return true;
  }

  return false;
}

export function isSpreadsheetPlaceholderRow(cells: unknown[]): boolean {
  if (!Array.isArray(cells) || cells.length === 0) {
    return true;
  }

  return cells.every(isSpreadsheetPlaceholderCell);
}

/** @deprecated Use {@link isSpreadsheetPlaceholderRow}. */
export function isSpreadsheetBlankRow(cells: unknown[]): boolean {
  return isSpreadsheetPlaceholderRow(cells);
}

/** Drops trailing all-blank rows and unused trailing columns in the used range. */
export function trimSpreadsheetMatrix(rows: unknown[][]): unknown[][] {
  if (rows.length === 0) {
    return rows;
  }

  let lastRowIndex = -1;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (Array.isArray(row) && !isSpreadsheetPlaceholderRow(row)) {
      lastRowIndex = rowIndex;
    }
  }

  if (lastRowIndex === -1) {
    return [];
  }

  const rowSlice = rows.slice(0, lastRowIndex + 1);

  let lastColumnIndex = -1;
  for (const row of rowSlice) {
    if (!Array.isArray(row)) {
      continue;
    }
    for (let columnIndex = row.length - 1; columnIndex >= 0; columnIndex -= 1) {
      if (!isSpreadsheetPlaceholderCell(row[columnIndex])) {
        lastColumnIndex = Math.max(lastColumnIndex, columnIndex);
        break;
      }
    }
  }

  if (lastColumnIndex === -1) {
    return rowSlice.map(() => [] as unknown[]);
  }

  return rowSlice.map((row) => {
    const cells = Array.isArray(row) ? row : [];
    return cells.slice(0, lastColumnIndex + 1);
  });
}

export function assertSpreadsheetDataRowCountWithinLimit(
  dataRowCount: number,
): void {
  if (dataRowCount > SPREADSHEET_UPLOAD_MAX_ROWS) {
    throw spreadsheetTooManyDataRowsError();
  }
}

/** Trim used range, then enforce the 10,000 data-row cap (not physical row count). */
export function normalizeSpreadsheetMatrixForImport(rows: unknown[][]): unknown[][] {
  return trimSpreadsheetMatrix(rows);
}
