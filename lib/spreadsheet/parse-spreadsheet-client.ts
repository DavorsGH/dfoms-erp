import * as XLSX from "xlsx";

import {
  countSpreadsheetLayoutDataRows,
  parseSpreadsheetMatrixLayout,
} from "@/lib/spreadsheet/spreadsheet-layout-parse";
import { detectSpreadsheetHeaderRowIndex } from "@/lib/spreadsheet/spreadsheet-header-detection";
import {
  assertSpreadsheetDataRowCountWithinLimit,
  normalizeSpreadsheetMatrixForImport,
  SPREADSHEET_READ_HARDENING,
  trimSpreadsheetMatrix,
} from "@/lib/spreadsheet/spreadsheet-matrix-utils";
import {
  SpreadsheetValidationError,
  spreadsheetNoWorksheetsError,
  spreadsheetUnsupportedTypeError,
  spreadsheetUnreadableError,
} from "@/lib/spreadsheet/spreadsheet-validation-error";
import {
  getSpreadsheetExtension,
  validateSpreadsheetFileSelection,
} from "@/lib/spreadsheet/spreadsheet-upload-validation";

export type SpreadsheetSheetSummary = {
  name: string;
  dataRowCount: number;
  /** 0-based index of the auto-detected header row. */
  detectedHeaderRowIndex: number;
};

export type ParsedSpreadsheetClient = {
  headers: string[];
  dataRows: Record<string, unknown>[];
  headerRowIndex: number;
};

export type ParseSpreadsheetWorkbookSheetOptions = {
  rawCells?: boolean;
  /** 0-based header row; auto-detected when omitted. */
  headerRowIndex?: number;
};

export function readSpreadsheetWorkbook(
  fileName: string,
  buffer: ArrayBuffer,
): XLSX.WorkBook {
  validateSpreadsheetFileSelection({
    fileName,
    byteLength: buffer.byteLength,
  });

  const extension = getSpreadsheetExtension(fileName);
  if (!extension) {
    throw spreadsheetUnsupportedTypeError();
  }

  try {
    if (extension === "csv") {
      const text = new TextDecoder().decode(buffer);
      return XLSX.read(text, { type: "string", ...SPREADSHEET_READ_HARDENING });
    }

    return XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      ...SPREADSHEET_READ_HARDENING,
    });
  } catch (error) {
    if (error instanceof SpreadsheetValidationError) {
      throw error;
    }
    throw spreadsheetUnreadableError();
  }
}

function sheetToRowMatrix(
  sheet: XLSX.WorkSheet,
  useRawCells: boolean,
): unknown[][] {
  try {
    return XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: useRawCells,
    }) as unknown[][];
  } catch {
    throw spreadsheetUnreadableError();
  }
}

function resolveRawCells(
  fileName: string,
  rawCells?: boolean,
): boolean {
  const extension = getSpreadsheetExtension(fileName);
  return rawCells ?? (extension === "xlsx" || extension === "xls");
}

export function sheetMatrixFromWorkbook(
  workbook: XLSX.WorkBook,
  fileName: string,
  sheetName: string,
  rawCells?: boolean,
): unknown[][] {
  const useRawCells = resolveRawCells(fileName, rawCells);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw spreadsheetNoWorksheetsError();
  }

  const rows = sheetToRowMatrix(sheet, useRawCells);
  return normalizeSpreadsheetMatrixForImport(rows);
}

export function summarizeSpreadsheetSheet(
  rows: unknown[][],
  headerRowIndex?: number,
): Pick<SpreadsheetSheetSummary, "dataRowCount" | "detectedHeaderRowIndex"> {
  const trimmed = trimSpreadsheetMatrix(rows);
  const detectedHeaderRowIndex = detectSpreadsheetHeaderRowIndex(trimmed);
  const resolvedHeader = headerRowIndex ?? detectedHeaderRowIndex;
  const dataRowCount = countSpreadsheetLayoutDataRows(trimmed, resolvedHeader);

  return { dataRowCount, detectedHeaderRowIndex };
}

export function listSpreadsheetSheetSummaries(
  workbook: XLSX.WorkBook,
  fileName: string,
  rawCells?: boolean,
): SpreadsheetSheetSummary[] {
  const useRawCells = resolveRawCells(fileName, rawCells);

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    let summary: Pick<
      SpreadsheetSheetSummary,
      "dataRowCount" | "detectedHeaderRowIndex"
    > = { dataRowCount: 0, detectedHeaderRowIndex: 0 };

    try {
      const rows = sheetToRowMatrix(sheet, useRawCells);
      summary = summarizeSpreadsheetSheet(rows);
    } catch {
      summary = { dataRowCount: 0, detectedHeaderRowIndex: 0 };
    }

    return {
      name,
      ...summary,
    };
  });
}

export function pickDefaultSpreadsheetSheetName(
  summaries: SpreadsheetSheetSummary[],
  workbook: XLSX.WorkBook,
): string {
  const withData = summaries.find((sheet) => sheet.dataRowCount > 0);
  if (withData) {
    return withData.name;
  }

  return workbook.SheetNames[0] ?? summaries[0]?.name ?? "";
}

export function parseSpreadsheetWorkbookSheet(
  workbook: XLSX.WorkBook,
  fileName: string,
  sheetName: string,
  options: ParseSpreadsheetWorkbookSheetOptions = {},
): ParsedSpreadsheetClient {
  const rows = sheetMatrixFromWorkbook(
    workbook,
    fileName,
    sheetName,
    options.rawCells,
  );

  const layout = parseSpreadsheetMatrixLayout(rows, {
    headerRowIndex: options.headerRowIndex,
  });

  assertSpreadsheetDataRowCountWithinLimit(layout.dataRows.length);

  return {
    headers: layout.headers,
    dataRows: layout.dataRows,
    headerRowIndex: layout.headerRowIndex,
  };
}

export async function loadSpreadsheetWorkbookFromFile(file: File): Promise<{
  buffer: ArrayBuffer;
  workbook: XLSX.WorkBook;
  sheetSummaries: SpreadsheetSheetSummary[];
  defaultSheetName: string;
}> {
  validateSpreadsheetFileSelection({
    fileName: file.name,
    byteLength: file.size,
    mimeType: file.type,
  });

  const buffer = await file.arrayBuffer();

  validateSpreadsheetFileSelection({
    fileName: file.name,
    byteLength: buffer.byteLength,
    mimeType: file.type,
  });

  const workbook = readSpreadsheetWorkbook(file.name, buffer);
  const sheetSummaries = listSpreadsheetSheetSummaries(workbook, file.name);
  const defaultSheetName = pickDefaultSpreadsheetSheetName(
    sheetSummaries,
    workbook,
  );

  return { buffer, workbook, sheetSummaries, defaultSheetName };
}

export async function parseSpreadsheetFileSheet(
  file: File,
  sheetName: string,
  options: ParseSpreadsheetWorkbookSheetOptions = {},
): Promise<ParsedSpreadsheetClient> {
  const { workbook } = await loadSpreadsheetWorkbookFromFile(file);
  return parseSpreadsheetWorkbookSheet(workbook, file.name, sheetName, options);
}
