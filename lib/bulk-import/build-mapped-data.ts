import { stripBulkImportColumnMappingMeta } from "@/lib/bulk-import/column-mapping-meta";
import type { BulkImportColumnMapping } from "@/lib/bulk-import/types";

/** Apply a saved header → target-field mapping to one staged raw_data row. */
export function buildMappedData(
  rawData: Record<string, unknown>,
  columnMapping: BulkImportColumnMapping,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  const cleanedMapping = stripBulkImportColumnMappingMeta(columnMapping);

  for (const [header, targetField] of Object.entries(cleanedMapping)) {
    if (Object.prototype.hasOwnProperty.call(rawData, header)) {
      mapped[targetField] = rawData[header];
    }
  }

  return mapped;
}
