import { isDangerousSpreadsheetKey } from "@/lib/spreadsheet/safe-spreadsheet-parse";
import { isSpreadsheetPlaceholderRow } from "@/lib/spreadsheet/spreadsheet-matrix-utils";
import {
  spreadsheetEmptyFileError,
  spreadsheetTooManyDataRowsError,
} from "@/lib/spreadsheet/spreadsheet-validation-error";
import { SPREADSHEET_UPLOAD_MAX_ROWS } from "@/lib/spreadsheet/spreadsheet-upload-validation";

function cellToJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === undefined || value === null) {
    return null;
  }

  return value;
}

export function normalizeSpreadsheetHeaders(rawHeaders: unknown[]): string[] {
  const seen = new Map<string, number>();

  return rawHeaders.map((header, index) => {
    let label = String(header ?? "").trim() || `Column ${index + 1}`;
    const count = seen.get(label) ?? 0;
    seen.set(label, count + 1);

    if (count > 0) {
      label = `${label} (${count + 1})`;
    }

    return label;
  });
}

export function matrixToHeaderDataRows(rows: unknown[][]): {
  headers: string[];
  dataRows: Record<string, unknown>[];
} {
  if (rows.length === 0) {
    throw spreadsheetEmptyFileError();
  }

  const headers = normalizeSpreadsheetHeaders(rows[0] ?? []);
  const dataRows: Record<string, unknown>[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row) || isSpreadsheetPlaceholderRow(row)) {
      continue;
    }

    const rawData: Record<string, unknown> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      if (isDangerousSpreadsheetKey(header)) {
        continue;
      }

      rawData[header] = cellToJsonValue(row[columnIndex]);
    }

    dataRows.push(rawData);
  }

  if (dataRows.length > SPREADSHEET_UPLOAD_MAX_ROWS) {
    throw spreadsheetTooManyDataRowsError();
  }

  return { headers, dataRows };
}
