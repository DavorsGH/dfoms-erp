import "server-only";

import { parseSpreadsheetSheetRows } from "@/lib/spreadsheet/safe-spreadsheet-parse";
import { parseSpreadsheetMatrixLayout } from "@/lib/spreadsheet/spreadsheet-layout-parse";
import { assertSpreadsheetDataRowCountWithinLimit } from "@/lib/spreadsheet/spreadsheet-matrix-utils";

export type ParsedSpreadsheetUpload = {
  headers: string[];
  dataRows: Record<string, unknown>[];
};

const ROW_INSERT_BATCH_SIZE = 500;

export { ROW_INSERT_BATCH_SIZE };

export function parseSpreadsheetUpload(
  fileName: string,
  buffer: ArrayBuffer,
): ParsedSpreadsheetUpload {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const rows = parseSpreadsheetSheetRows(fileName, buffer, {
    rawCells: extension === "xlsx" || extension === "xls",
  });

  const layout = parseSpreadsheetMatrixLayout(rows);
  assertSpreadsheetDataRowCountWithinLimit(layout.dataRows.length);
  return { headers: layout.headers, dataRows: layout.dataRows };
}
