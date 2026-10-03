import { detectSpreadsheetHeaderRowIndex } from "@/lib/spreadsheet/spreadsheet-header-detection";
import {
  isSpreadsheetPlaceholderCell,
  isSpreadsheetPlaceholderRow,
} from "@/lib/spreadsheet/spreadsheet-matrix-utils";
import { isDangerousSpreadsheetKey } from "@/lib/spreadsheet/safe-spreadsheet-parse";
import {
  matrixToHeaderDataRows,
  normalizeSpreadsheetHeaders,
} from "@/lib/spreadsheet/spreadsheet-row-records";

export type SpreadsheetLayoutParseOptions = {
  /** 0-based row index of column headers; auto-detected when omitted. */
  headerRowIndex?: number;
};

export type SpreadsheetLayoutParseResult = {
  headerRowIndex: number;
  headers: string[];
  dataRows: Record<string, unknown>[];
};

function columnCount(matrix: unknown[][]): number {
  let max = 0;
  for (const row of matrix) {
    if (Array.isArray(row)) {
      max = Math.max(max, row.length);
    }
  }
  return max;
}

/** Drop columns with no header text and no non-placeholder data in any row. */
export function filterSpreadsheetImportColumns(matrix: unknown[][]): unknown[][] {
  if (matrix.length === 0) {
    return matrix;
  }

  const colCount = columnCount(matrix);
  const keepColumn: boolean[] = [];

  for (let columnIndex = 0; columnIndex < colCount; columnIndex += 1) {
    const headerCell = matrix[0]?.[columnIndex];
    const headerText = String(headerCell ?? "").trim();
    let hasData = false;

    if (headerText !== "") {
      keepColumn[columnIndex] = true;
      continue;
    }

    for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
      const row = matrix[rowIndex];
      if (!Array.isArray(row)) {
        continue;
      }
      if (!isSpreadsheetPlaceholderCell(row[columnIndex])) {
        hasData = true;
        break;
      }
    }

    keepColumn[columnIndex] = hasData;
  }

  return matrix.map((row) => {
    const cells = Array.isArray(row) ? row : [];
    const next: unknown[] = [];
    for (let columnIndex = 0; columnIndex < colCount; columnIndex += 1) {
      if (keepColumn[columnIndex]) {
        next.push(cells[columnIndex]);
      }
    }
    return next;
  });
}

export function parseSpreadsheetMatrixLayout(
  rows: unknown[][],
  options: SpreadsheetLayoutParseOptions = {},
): SpreadsheetLayoutParseResult {
  const headerRowIndex =
    options.headerRowIndex ?? detectSpreadsheetHeaderRowIndex(rows);

  const headerRow = rows[headerRowIndex] ?? [];
  const bodyRows = rows.slice(headerRowIndex + 1);
  const combined = [headerRow, ...bodyRows];
  const filtered = filterSpreadsheetImportColumns(combined);

  const parsed = matrixToHeaderDataRows(filtered);

  return {
    headerRowIndex,
    headers: parsed.headers,
    dataRows: parsed.dataRows,
  };
}

export type SpreadsheetLayoutRecord = {
  /** 1-based row number in the original worksheet. */
  rowNumber: number;
  record: Record<string, unknown>;
};

function cellToJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === undefined || value === null) {
    return null;
  }

  return value;
}

export function listSpreadsheetLayoutRecords(
  rows: unknown[][],
  options: SpreadsheetLayoutParseOptions = {},
): {
  headerRowIndex: number;
  headers: string[];
  records: SpreadsheetLayoutRecord[];
} {
  const headerRowIndex =
    options.headerRowIndex ?? detectSpreadsheetHeaderRowIndex(rows);
  const headerRow = rows[headerRowIndex] ?? [];
  const bodyRows = rows.slice(headerRowIndex + 1);
  const combined = [headerRow, ...bodyRows];
  const filtered = filterSpreadsheetImportColumns(combined);

  if (filtered.length === 0) {
    return { headerRowIndex, headers: [], records: [] };
  }

  const headers = normalizeSpreadsheetHeaders(filtered[0] ?? []);
  const records: SpreadsheetLayoutRecord[] = [];

  for (let filteredIndex = 1; filteredIndex < filtered.length; filteredIndex += 1) {
    const row = filtered[filteredIndex];
    if (!Array.isArray(row) || isSpreadsheetPlaceholderRow(row)) {
      continue;
    }

    const record: Record<string, unknown> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      if (isDangerousSpreadsheetKey(header)) {
        continue;
      }

      record[header] = cellToJsonValue(row[columnIndex]);
    }

    records.push({
      rowNumber: headerRowIndex + filteredIndex + 1,
      record,
    });
  }

  return { headerRowIndex, headers, records };
}

export function countSpreadsheetLayoutDataRows(
  rows: unknown[][],
  headerRowIndex?: number,
): number {
  const resolvedHeader =
    headerRowIndex ?? detectSpreadsheetHeaderRowIndex(rows);

  let count = 0;
  for (let index = resolvedHeader + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (Array.isArray(row) && !isSpreadsheetPlaceholderRow(row)) {
      count += 1;
    }
  }

  return count;
}
