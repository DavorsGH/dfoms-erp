import {
  isSpreadsheetPlaceholderCell,
  isSpreadsheetPlaceholderRow,
} from "@/lib/spreadsheet/spreadsheet-matrix-utils";

export const SPREADSHEET_HEADER_SEARCH_MAX_ROWS = 20;

function cellDisplayValue(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value ?? "").trim();
}

/** Header labels are usually text, not bare numbers or placeholders. */
export function isSpreadsheetHeaderLikeCell(value: unknown): boolean {
  if (isSpreadsheetPlaceholderCell(value)) {
    return false;
  }

  if (value instanceof Date) {
    return false;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return false;
  }

  const text = cellDisplayValue(value);
  if (text.length === 0) {
    return false;
  }

  if (/^-?\d+(\.\d+)?$/.test(text.replace(/,/g, ""))) {
    return false;
  }

  return true;
}

function countHeaderLikeCells(row: unknown[]): number {
  if (!Array.isArray(row)) {
    return 0;
  }

  let count = 0;
  for (const cell of row) {
    if (isSpreadsheetHeaderLikeCell(cell)) {
      count += 1;
    }
  }
  return count;
}

function countNonPlaceholderCells(row: unknown[]): number {
  if (!Array.isArray(row)) {
    return 0;
  }

  let count = 0;
  for (const cell of row) {
    if (!isSpreadsheetPlaceholderCell(cell)) {
      count += 1;
    }
  }
  return count;
}

function rowLooksLikeData(row: unknown[]): boolean {
  if (!Array.isArray(row) || isSpreadsheetPlaceholderRow(row)) {
    return false;
  }

  return countNonPlaceholderCells(row) >= 1;
}

function countMeaningfulDataRowsBelow(
  rows: unknown[][],
  headerRowIndex: number,
  sampleSize = 25,
): number {
  let count = 0;
  const end = Math.min(rows.length, headerRowIndex + 1 + sampleSize);

  for (let index = headerRowIndex + 1; index < end; index += 1) {
    const row = rows[index];
    if (Array.isArray(row) && rowLooksLikeData(row)) {
      count += 1;
    }
  }

  return count;
}

function scoreHeaderCandidate(rows: unknown[][], headerRowIndex: number): number {
  const row = rows[headerRowIndex];
  if (!Array.isArray(row)) {
    return -1;
  }

  const nonEmpty = countNonPlaceholderCells(row);
  if (nonEmpty < 3) {
    return -1;
  }

  const headerLike = countHeaderLikeCells(row);
  if (headerLike < 3) {
    return -1;
  }

  if (headerLike / nonEmpty < 0.5) {
    return -1;
  }

  const dataBelow = countMeaningfulDataRowsBelow(rows, headerRowIndex);
  if (dataBelow === 0) {
    return -1;
  }

  return headerLike * 10 + dataBelow;
}

/**
 * Returns 0-based index of the detected header row within the first
 * {@link SPREADSHEET_HEADER_SEARCH_MAX_ROWS} rows, or 0 if none score.
 */
export function detectSpreadsheetHeaderRowIndex(rows: unknown[][]): number {
  if (rows.length === 0) {
    return 0;
  }

  const searchLimit = Math.min(rows.length, SPREADSHEET_HEADER_SEARCH_MAX_ROWS);
  let bestIndex = 0;
  let bestScore = -1;

  for (let index = 0; index < searchLimit; index += 1) {
    const score = scoreHeaderCandidate(rows, index);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  if (bestScore < 0) {
    return 0;
  }

  return bestIndex;
}
