import type { BulkImportColumnMapping } from "@/lib/bulk-import/types";

/** Stored in job column_mapping; not a spreadsheet column. */
export const BULK_IMPORT_HEADER_ROW_INDEX_MAPPING_KEY =
  "__bulk_import_header_row_index__";

export function stripBulkImportColumnMappingMeta(
  mapping: BulkImportColumnMapping,
): BulkImportColumnMapping {
  const cleaned: BulkImportColumnMapping = {};
  for (const [header, target] of Object.entries(mapping)) {
    if (header === BULK_IMPORT_HEADER_ROW_INDEX_MAPPING_KEY) {
      continue;
    }
    cleaned[header] = target;
  }
  return cleaned;
}

export function readBulkImportHeaderRowIndex(
  mapping: BulkImportColumnMapping,
): number {
  const raw = mapping[BULK_IMPORT_HEADER_ROW_INDEX_MAPPING_KEY];
  if (raw === undefined) {
    return 0;
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

export function withBulkImportHeaderRowIndex(
  mapping: BulkImportColumnMapping,
  headerRowIndex: number,
): BulkImportColumnMapping {
  return {
    ...stripBulkImportColumnMappingMeta(mapping),
    [BULK_IMPORT_HEADER_ROW_INDEX_MAPPING_KEY]: String(
      Math.max(0, Math.trunc(headerRowIndex)),
    ),
  };
}
