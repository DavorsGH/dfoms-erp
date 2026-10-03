import { yieldToBrowser } from "@/lib/bulk-import/yield-to-browser";
import type { BulkImportSpreadsheetParseWorkerRequest } from "@/lib/spreadsheet/bulk-import-spreadsheet-parse.worker";
import {
  parseSpreadsheetWorkbookSheet,
  readSpreadsheetWorkbook,
  type ParsedSpreadsheetClient,
} from "@/lib/spreadsheet/parse-spreadsheet-client";

const WORKER_PARSE_TIMEOUT_MS = 120_000;

function parseSpreadsheetOnMainThread(
  input: BulkImportSpreadsheetParseWorkerRequest,
): ParsedSpreadsheetClient {
  const workbook = readSpreadsheetWorkbook(input.fileName, input.buffer);
  return parseSpreadsheetWorkbookSheet(
    workbook,
    input.fileName,
    input.sheetName,
    { headerRowIndex: input.headerRowIndex },
  );
}

function parseSpreadsheetInDedicatedWorker(
  input: BulkImportSpreadsheetParseWorkerRequest,
): Promise<ParsedSpreadsheetClient> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./bulk-import-spreadsheet-parse.worker.ts", import.meta.url),
    );

    const timeoutId = window.setTimeout(() => {
      worker.terminate();
      reject(new Error("Spreadsheet parse timed out."));
    }, WORKER_PARSE_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<{ ok: boolean; parsed?: ParsedSpreadsheetClient; message?: string }>) => {
      window.clearTimeout(timeoutId);
      worker.terminate();

      const payload = event.data;
      if (payload.ok && payload.parsed) {
        resolve(payload.parsed);
        return;
      }

      reject(new Error(payload.message ?? "Spreadsheet parse failed in worker."));
    };

    worker.onerror = (error) => {
      window.clearTimeout(timeoutId);
      worker.terminate();
      reject(error);
    };

    worker.postMessage(input);
  });
}

export type BulkImportSpreadsheetParseMode = "web-worker" | "main-thread-fallback";

export async function parseSpreadsheetForBulkImport(input: {
  fileName: string;
  buffer: ArrayBuffer;
  sheetName: string;
  headerRowIndex?: number;
}): Promise<{ parsed: ParsedSpreadsheetClient; mode: BulkImportSpreadsheetParseMode }> {
  await yieldToBrowser();

  if (typeof Worker !== "undefined") {
    try {
      const parsed = await parseSpreadsheetInDedicatedWorker(input);
      return { parsed, mode: "web-worker" };
    } catch (workerError) {
      console.warn("Bulk import spreadsheet worker failed; using main thread.", workerError);
    }
  }

  await yieldToBrowser();
  const parsed = parseSpreadsheetOnMainThread(input);
  return { parsed, mode: "main-thread-fallback" };
}
