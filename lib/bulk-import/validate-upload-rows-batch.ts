import { SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE } from "@/lib/spreadsheet/spreadsheet-validation-error";
import { SPREADSHEET_UPLOAD_MAX_ROWS } from "@/lib/spreadsheet/spreadsheet-upload-validation";

export type BulkImportRowBatchInput = {
  row_number: number;
  raw_data: unknown;
};

export type BulkImportRowBatchValidationResult =
  | {
      ok: true;
      rowNumbers: number[];
    }
  | { ok: false; status: number; error: string };

export function validateBulkImportRowNumbersInBatch(
  rows: BulkImportRowBatchInput[],
  totalRows: number,
): BulkImportRowBatchValidationResult {
  const rowNumbers: number[] = [];

  for (const row of rows) {
    const rowNumber = Number(row.row_number);
    if (
      !Number.isInteger(rowNumber) ||
      rowNumber < 1 ||
      rowNumber > totalRows
    ) {
      return {
        ok: false,
        status: 400,
        error: "One or more row numbers in this batch are invalid.",
      };
    }
    rowNumbers.push(rowNumber);
  }

  const unique = new Set(rowNumbers);
  if (unique.size !== rowNumbers.length) {
    return {
      ok: false,
      status: 400,
      error: "This batch contains duplicate row numbers.",
    };
  }

  return { ok: true, rowNumbers };
}

export function validateBulkImportCumulativeRowCount(input: {
  alreadyStored: number;
  batchSize: number;
  declaredTotalRows: number;
}): BulkImportRowBatchValidationResult {
  const { alreadyStored, batchSize, declaredTotalRows } = input;
  const nextTotal = alreadyStored + batchSize;

  if (alreadyStored >= SPREADSHEET_UPLOAD_MAX_ROWS) {
    return {
      ok: false,
      status: 400,
      error: SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE,
    };
  }

  if (nextTotal > declaredTotalRows) {
    return {
      ok: false,
      status: 400,
      error: "Row batch exceeds the declared import size.",
    };
  }

  if (nextTotal > SPREADSHEET_UPLOAD_MAX_ROWS) {
    return {
      ok: false,
      status: 400,
      error: SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE,
    };
  }

  if (declaredTotalRows > SPREADSHEET_UPLOAD_MAX_ROWS) {
    return {
      ok: false,
      status: 400,
      error: SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE,
    };
  }

  return { ok: true, rowNumbers: [] };
}
