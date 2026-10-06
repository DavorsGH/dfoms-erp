/** Shared Review-step fix phrasing (upload again, not “re-validate”). */

export const BULK_IMPORT_FIX_UPLOAD_AGAIN =
  "Correct the value in your spreadsheet and upload the file again.";

export function bulkImportFixEnterValueUploadAgain(): string {
  return "Enter a value in your spreadsheet and upload the file again.";
}

export function bulkImportFixEnterNumberUploadAgain(example = "100"): string {
  return `Enter a number, such as ${example}, and upload the file again.`;
}

export function bulkImportFixEnterDateUploadAgain(): string {
  return "Use a date like 15/01/2026 or 2026-01-15 and upload the file again.";
}

export function bulkImportFixReduceDecimalsUploadAgain(): string {
  return "Reduce decimal places and upload the file again.";
}

export function bulkImportFixEnterSmallerValueUploadAgain(): string {
  return "Enter a smaller value and upload the file again.";
}

export function bulkImportFixConfirmDatesBeforeImport(): string {
  return "Confirm each date is correct before importing.";
}

export function bulkImportProblemWithQuotedValue(
  columnLabel: string,
  cellValue: string,
  problemSuffix: string,
): string {
  const trimmed = cellValue.trim();
  if (!trimmed) {
    return `${columnLabel} ${problemSuffix}`.replace(/\s+/g, " ").trim();
  }
  return `${columnLabel} "${trimmed}" ${problemSuffix}`.replace(/\s+/g, " ").trim();
}
