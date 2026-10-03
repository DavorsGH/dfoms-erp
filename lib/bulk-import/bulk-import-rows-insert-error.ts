export const BULK_IMPORT_ROWS_JOB_ROW_NUMBER_UNIQUE_CONSTRAINT =
  "bulk_import_rows_job_id_row_number_key";

export const BULK_IMPORT_ROWS_RACE_CONFLICT_MESSAGE =
  "Some rows in this batch were already uploaded for this import. Please restart the import from the Upload step.";

type PostgrestLikeError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

export function isBulkImportRowsJobRowNumberUniqueViolation(
  error: PostgrestLikeError,
): boolean {
  if (error.code !== "23505") {
    return false;
  }

  const combined = `${error.message ?? ""} ${error.details ?? ""}`;
  return combined.includes(BULK_IMPORT_ROWS_JOB_ROW_NUMBER_UNIQUE_CONSTRAINT);
}
