/// <reference lib="webworker" />

import {
  parseSpreadsheetWorkbookSheet,
  readSpreadsheetWorkbook,
  type ParsedSpreadsheetClient,
} from "@/lib/spreadsheet/parse-spreadsheet-client";

export type BulkImportSpreadsheetParseWorkerRequest = {
  fileName: string;
  buffer: ArrayBuffer;
  sheetName: string;
  headerRowIndex?: number;
};

export type BulkImportSpreadsheetParseWorkerResponse =
  | { ok: true; parsed: ParsedSpreadsheetClient }
  | { ok: false; message: string };

self.onmessage = (event: MessageEvent<BulkImportSpreadsheetParseWorkerRequest>) => {
  try {
    const { fileName, buffer, sheetName, headerRowIndex } = event.data;
    const workbook = readSpreadsheetWorkbook(fileName, buffer);
    const parsed = parseSpreadsheetWorkbookSheet(workbook, fileName, sheetName, {
      headerRowIndex,
    });

    const response: BulkImportSpreadsheetParseWorkerResponse = {
      ok: true,
      parsed,
    };
    self.postMessage(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Spreadsheet parse failed in worker.";
    const response: BulkImportSpreadsheetParseWorkerResponse = {
      ok: false,
      message,
    };
    self.postMessage(response);
  }
};
