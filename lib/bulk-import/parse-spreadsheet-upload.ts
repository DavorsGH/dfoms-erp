import "server-only";

import * as XLSX from "xlsx";

export type ParsedSpreadsheetUpload = {
  headers: string[];
  dataRows: Record<string, unknown>[];
};

const ROW_INSERT_BATCH_SIZE = 500;

export { ROW_INSERT_BATCH_SIZE };

function cellToJsonValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value === undefined || value === null) {
    return null;
  }

  return value;
}

function isBlankRow(cells: unknown[]): boolean {
  return cells.every((cell) => String(cell ?? "").trim() === "");
}

function normalizeHeaders(rawHeaders: unknown[]): string[] {
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

export function parseSpreadsheetUpload(
  fileName: string,
  buffer: ArrayBuffer,
): ParsedSpreadsheetUpload {
  const extension = fileName.split(".").pop()?.toLowerCase();

  let workbook: XLSX.WorkBook;
  if (extension === "csv") {
    const text = new TextDecoder().decode(buffer);
    workbook = XLSX.read(text, { type: "string" });
  } else if (extension === "xlsx") {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } else {
    throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("File contains no worksheets.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: "",
    raw: extension === "xlsx",
  }) as unknown[][];

  if (rows.length === 0) {
    throw new Error("File is empty.");
  }

  const headers = normalizeHeaders(rows[0] ?? []);
  const dataRows: Record<string, unknown>[] = [];

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!Array.isArray(row) || isBlankRow(row)) {
      continue;
    }

    const rawData: Record<string, unknown> = {};
    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      rawData[headers[columnIndex]] = cellToJsonValue(row[columnIndex]);
    }

    dataRows.push(rawData);
  }

  return { headers, dataRows };
}
