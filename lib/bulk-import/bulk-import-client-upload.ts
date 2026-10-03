import { computeBulkImportFileHashClient } from "@/lib/bulk-import/compute-file-hash-client";
import {
  chunkBulkImportDataRows,
  estimateBulkImportRowsBatchSize,
} from "@/lib/bulk-import/upload-rows-batch";
import type { BulkImportType, BulkImportUploadResponse } from "@/lib/bulk-import/types";
import { parseSpreadsheetWorkbookSheet } from "@/lib/spreadsheet/parse-spreadsheet-client";
import {
  readSpreadsheetImportJsonResponse,
  spreadsheetImportUploadFailedAlert,
  type SpreadsheetImportAlert,
} from "@/lib/spreadsheet/spreadsheet-import-alerts";
import type * as XLSX from "xlsx";

type UploadParsedSpreadsheet = {
  headers: string[];
  dataRows: Record<string, unknown>[];
};

export type BulkImportBatchUploadProgress = {
  uploadedRows: number;
  totalRows: number;
};

export type BulkImportBatchUploadResult =
  | { ok: true; response: BulkImportUploadResponse }
  | { ok: false; alert: SpreadsheetImportAlert };

async function postBulkImportUploadJson<T>(
  body: unknown,
): Promise<
  { ok: true; data: T } | { ok: false; alert: SpreadsheetImportAlert }
> {
  const response = await fetch("/api/bulk-import/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return readSpreadsheetImportJsonResponse<T>(response);
}

export async function uploadBulkImportParsedSpreadsheet(input: {
  importType: BulkImportType;
  fileName: string;
  fileBuffer: ArrayBuffer;
  parsed: UploadParsedSpreadsheet;
  onProgress?: (progress: BulkImportBatchUploadProgress) => void;
}): Promise<BulkImportBatchUploadResult> {
  const { importType, fileName, fileBuffer, parsed, onProgress } = input;
  const { headers, dataRows } = parsed;

  let fileHash: string;
  try {
    fileHash = await computeBulkImportFileHashClient(fileBuffer);
  } catch (error) {
    console.error("Bulk import file hash failed", error);
    return { ok: false, alert: spreadsheetImportUploadFailedAlert() };
  }

  const initResult = await postBulkImportUploadJson<
    BulkImportUploadResponse & { error?: string }
  >({
    action: "init",
    import_type: importType,
    file_name: fileName,
    file_hash: fileHash,
    headers,
    total_rows: dataRows.length,
  });

  if (!initResult.ok) {
    return { ok: false, alert: initResult.alert };
  }

  const initPayload = initResult.data;
  const jobId = initPayload.job_id;

  if (initPayload.possibleReupload) {
    return { ok: true, response: initPayload };
  }

  const rowsUpload = await uploadBulkImportRowsForExistingJob({
    jobId,
    dataRows,
    onProgress,
  });

  if (!rowsUpload.ok) {
    await fetch(`/api/bulk-import/${jobId}`, { method: "DELETE" }).catch(
      (deleteError) => {
        console.error("Bulk import cleanup after failed batch", deleteError);
      },
    );
    return rowsUpload;
  }

  return {
    ok: true,
    response: {
      job_id: jobId,
      headers: initPayload.headers ?? headers,
    },
  };
}

export async function uploadBulkImportRowsForExistingJob(input: {
  jobId: string;
  dataRows: Record<string, unknown>[];
  onProgress?: (progress: BulkImportBatchUploadProgress) => void;
}): Promise<BulkImportBatchUploadResult> {
  const { jobId, dataRows, onProgress } = input;

  const sampleRow = dataRows[0] ?? {};
  const batchSize = estimateBulkImportRowsBatchSize(sampleRow);
  const batches = chunkBulkImportDataRows(dataRows, batchSize);
  let uploadedRows = 0;
  const totalRows = dataRows.length;

  onProgress?.({ uploadedRows: 0, totalRows });

  for (const batch of batches) {
    const rowsPayload = batch.map((rawData, batchIndex) => ({
      row_number: uploadedRows + batchIndex + 1,
      raw_data: rawData,
    }));

    const rowsResult = await postBulkImportUploadJson<{ ok?: boolean }>({
      action: "rows",
      job_id: jobId,
      rows: rowsPayload,
    });

    if (!rowsResult.ok) {
      return { ok: false, alert: rowsResult.alert };
    }

    uploadedRows += batch.length;
    onProgress?.({ uploadedRows, totalRows });
  }

  return {
    ok: true,
    response: {
      job_id: jobId,
      headers: [],
    },
  };
}

export function parseWorkbookSheetForBulkImport(
  workbook: XLSX.WorkBook,
  fileName: string,
  sheetName: string,
  options: { headerRowIndex?: number } = {},
): UploadParsedSpreadsheet {
  return parseSpreadsheetWorkbookSheet(workbook, fileName, sheetName, options);
}
