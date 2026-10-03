export const BULK_IMPORT_CLIENT_ROW_BATCH_SIZE = 500;

export const BULK_IMPORT_CLIENT_TARGET_BATCH_BYTES = 1024 * 1024;

export function chunkBulkImportDataRows<T>(
  rows: T[],
  maxRows: number = BULK_IMPORT_CLIENT_ROW_BATCH_SIZE,
): T[][] {
  const batches: T[][] = [];

  for (let offset = 0; offset < rows.length; offset += maxRows) {
    batches.push(rows.slice(offset, offset + maxRows));
  }

  return batches;
}

/** Shrink batch size until serialized payload fits under the byte budget. */
export function estimateBulkImportRowsBatchSize(
  sampleRow: Record<string, unknown>,
  startRows: number = BULK_IMPORT_CLIENT_ROW_BATCH_SIZE,
  maxBytes: number = BULK_IMPORT_CLIENT_TARGET_BATCH_BYTES,
): number {
  let batchSize = Math.max(1, Math.min(startRows, BULK_IMPORT_CLIENT_ROW_BATCH_SIZE));

  while (batchSize > 1) {
    const payload = JSON.stringify({
      action: "rows",
      job_id: "sample",
      rows: Array.from({ length: batchSize }, (_, index) => ({
        row_number: index + 1,
        raw_data: sampleRow,
      })),
    });

    if (payload.length <= maxBytes) {
      return batchSize;
    }

    batchSize = Math.floor(batchSize / 2);
  }

  return 1;
}
