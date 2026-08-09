import type { BulkImportColumnMapping } from "@/lib/bulk-import/types";

/** Apply a saved header → target-field mapping to one staged raw_data row. */
export function buildMappedData(
  rawData: Record<string, unknown>,
  columnMapping: BulkImportColumnMapping,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};

  for (const [header, targetField] of Object.entries(columnMapping)) {
    if (Object.prototype.hasOwnProperty.call(rawData, header)) {
      mapped[targetField] = rawData[header];
    }
  }

  return mapped;
}
