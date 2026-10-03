import * as XLSX from "xlsx";

import {
  parseSpreadsheetMatrixLayout,
  type SpreadsheetLayoutParseResult,
} from "@/lib/spreadsheet/spreadsheet-layout-parse";
import {
  assertSpreadsheetDataRowCountWithinLimit,
  normalizeSpreadsheetMatrixForImport,
  SPREADSHEET_READ_HARDENING,
} from "@/lib/spreadsheet/spreadsheet-matrix-utils";

import {

  SpreadsheetValidationError,

  spreadsheetNoWorksheetsError,

  spreadsheetUnreadableError,

  spreadsheetUnsupportedTypeError,

} from "@/lib/spreadsheet/spreadsheet-validation-error";

import {

  getSpreadsheetExtension,

  validateSpreadsheetFileSelection,

  validateSpreadsheetUpload,

} from "@/lib/spreadsheet/spreadsheet-upload-validation";



export {

  getSpreadsheetExtension,

  SPREADSHEET_FILE_ACCEPT,

  SPREADSHEET_UPLOAD_MAX_BYTES,

  SPREADSHEET_UPLOAD_MAX_ROWS,

  validateSpreadsheetUpload,

} from "@/lib/spreadsheet/spreadsheet-upload-validation";



const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);



export function isDangerousSpreadsheetKey(key: string): boolean {

  return DANGEROUS_OBJECT_KEYS.has(key);

}



function readWorkbook(

  extension: string,

  buffer: ArrayBuffer,

): XLSX.WorkBook {

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



export type ParseSpreadsheetSheetRowsOptions = {
  /** When true, keep native cell values (dates/numbers) for Excel formats. */
  rawCells?: boolean;
};

export type ReadSpreadsheetImportLayoutOptions = ParseSpreadsheetSheetRowsOptions & {
  sheetName?: string;
  /** 0-based header row; auto-detected when omitted. */
  headerRowIndex?: number;
};



/**

 * Parses the first worksheet into a row matrix (header: 1). Validates size, type, and row limits.

 */

export function parseSpreadsheetSheetRows(

  fileName: string,

  buffer: ArrayBuffer,

  options: ParseSpreadsheetSheetRowsOptions = {},

): unknown[][] {

  validateSpreadsheetFileSelection({

    fileName,

    byteLength: buffer.byteLength,

  });



  const extension = getSpreadsheetExtension(fileName);

  if (!extension) {

    throw spreadsheetUnsupportedTypeError();

  }



  const workbook = readWorkbook(extension, buffer);



  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {

    throw spreadsheetNoWorksheetsError();

  }



  const sheet = workbook.Sheets[sheetName];

  let rows: unknown[][];

  try {

    rows = XLSX.utils.sheet_to_json(sheet, {

      header: 1,

      defval: "",

      raw: options.rawCells ?? (extension !== "csv"),

    }) as unknown[][];

  } catch {

    throw spreadsheetUnreadableError();

  }



  return normalizeSpreadsheetMatrixForImport(rows);
}

export async function readSpreadsheetImportLayout(
  file: File,
  options: ReadSpreadsheetImportLayoutOptions = {},
): Promise<SpreadsheetLayoutParseResult> {
  const rows = await readSpreadsheetFileToRows(file, options);
  const layout = parseSpreadsheetMatrixLayout(rows, {
    headerRowIndex: options.headerRowIndex,
  });
  assertSpreadsheetDataRowCountWithinLimit(layout.dataRows.length);
  return layout;
}

export function validateSpreadsheetFile(file: File): void {

  validateSpreadsheetFileSelection({

    fileName: file.name,

    byteLength: file.size,

    mimeType: file.type,

  });

}



export async function readSpreadsheetFileToRows(

  file: File,

  options: ParseSpreadsheetSheetRowsOptions & { sheetName?: string } = {},

): Promise<unknown[][]> {

  const { sheetName, ...parseOptions } = options;

  validateSpreadsheetFile(file);

  const buffer = await file.arrayBuffer();

  validateSpreadsheetFileSelection({

    fileName: file.name,

    byteLength: buffer.byteLength,

    mimeType: file.type,

  });



  if (sheetName) {

    const workbook = readSpreadsheetWorkbookFromBuffer(file.name, buffer);

    return sheetMatrixFromWorkbookClient(

      workbook,

      file.name,

      sheetName,

      parseOptions.rawCells,

    );

  }



  const extension = getSpreadsheetExtension(file.name);

  const rawCells =

    parseOptions.rawCells ?? (extension === "xlsx" || extension === "xls");



  return parseSpreadsheetSheetRows(file.name, buffer, { rawCells });

}



function readSpreadsheetWorkbookFromBuffer(

  fileName: string,

  buffer: ArrayBuffer,

): import("xlsx").WorkBook {

  const extension = getSpreadsheetExtension(fileName);

  if (!extension) {

    throw spreadsheetUnsupportedTypeError();

  }



  return readWorkbook(extension, buffer);

}



function sheetMatrixFromWorkbookClient(

  workbook: import("xlsx").WorkBook,

  fileName: string,

  sheetName: string,

  rawCells?: boolean,

): unknown[][] {

  const extension = getSpreadsheetExtension(fileName);

  const useRawCells =

    rawCells ?? (extension === "xlsx" || extension === "xls");

  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {

    throw spreadsheetNoWorksheetsError();

  }



  let rows: unknown[][];

  try {

    rows = XLSX.utils.sheet_to_json(sheet, {

      header: 1,

      defval: "",

      raw: useRawCells,

    }) as unknown[][];

  } catch {

    throw spreadsheetUnreadableError();

  }



  return normalizeSpreadsheetMatrixForImport(rows);

}


