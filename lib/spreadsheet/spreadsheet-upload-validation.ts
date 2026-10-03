import {
  SpreadsheetValidationError,
  spreadsheetFileTooLargeError,
  spreadsheetUnsupportedTypeError,
} from "@/lib/spreadsheet/spreadsheet-validation-error";

/** Maximum spreadsheet file size the user may select (parsed in the browser). */
export const SPREADSHEET_FILE_MAX_BYTES = 20 * 1024 * 1024;

/** @deprecated Alias for file limit — use SPREADSHEET_FILE_MAX_BYTES. */
export const SPREADSHEET_UPLOAD_MAX_BYTES = SPREADSHEET_FILE_MAX_BYTES;

/** Maximum JSON request body size for batched row uploads (under Vercel ~4.5 MB). */
export const SPREADSHEET_API_MAX_BODY_BYTES = 4 * 1024 * 1024;

export const SPREADSHEET_UPLOAD_HINT =
  "CSV or Excel (.csv, .xls, .xlsx), up to 20 MB and 10,000 rows.";
export const SPREADSHEET_UPLOAD_MAX_ROWS = 10_000;

/** Legacy multipart cap — raw file uploads are rejected. */
export const SPREADSHEET_UPLOAD_MAX_BODY_BYTES = SPREADSHEET_API_MAX_BODY_BYTES;

const ALLOWED_EXTENSIONS = new Set(["csv", "xlsx", "xls"]);

const MIME_BY_EXTENSION: Record<string, readonly string[]> = {
  csv: ["text/csv", "application/csv", "text/plain"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  xls: [
    "application/vnd.ms-excel",
    "application/msexcel",
    "application/vnd.ms-office",
  ],
};

const GENERIC_MIME_TYPES = new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
]);

export const SPREADSHEET_FILE_ACCEPT =
  ".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function formatSpreadsheetUploadSizeError(byteLength: number): string {
  const mb = (byteLength / (1024 * 1024)).toFixed(1);
  return `This file is ${mb} MB. The limit is 20 MB — split it into smaller files.`;
}

export function formatSpreadsheetApiBodyTooLargeError(): string {
  return "This upload batch is too large. Please try again.";
}

export function getSpreadsheetExtension(fileName: string): string | null {
  const trimmed = fileName.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === trimmed.length - 1) {
    return null;
  }

  const extension = trimmed.slice(dotIndex + 1).toLowerCase();
  return ALLOWED_EXTENSIONS.has(extension) ? extension : null;
}

function formatUnsupportedTypeMessage(): string {
  return "Unsupported file type. Upload a .csv, .xls, or .xlsx file.";
}

function assertMimeMatchesExtension(
  extension: string,
  mimeType: string | undefined,
): void {
  if (!mimeType || GENERIC_MIME_TYPES.has(mimeType)) {
    return;
  }

  const allowed = MIME_BY_EXTENSION[extension];
  if (!allowed?.includes(mimeType)) {
    throw spreadsheetUnsupportedTypeError();
  }
}

export function validateSpreadsheetFileSelection(input: {
  fileName: string;
  byteLength: number;
  mimeType?: string;
}): void {
  const { fileName, byteLength, mimeType } = input;

  if (byteLength > SPREADSHEET_FILE_MAX_BYTES) {
    throw spreadsheetFileTooLargeError(byteLength);
  }

  const extension = getSpreadsheetExtension(fileName);
  if (!extension) {
    throw spreadsheetUnsupportedTypeError();
  }

  assertMimeMatchesExtension(extension, mimeType?.trim().toLowerCase());
}

/** @deprecated Use validateSpreadsheetFileSelection */
export function validateSpreadsheetUpload(input: {
  fileName: string;
  byteLength: number;
  mimeType?: string;
}): void {
  validateSpreadsheetFileSelection(input);
}

export type SpreadsheetFileInspection =
  | { ok: true }
  | { ok: false; message: string };

/** Client-side check on file selection (uses File.size before upload). */
export function inspectSpreadsheetFile(file: File): SpreadsheetFileInspection {
  try {
    validateSpreadsheetFileSelection({
      fileName: file.name,
      byteLength: file.size,
      mimeType: file.type,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof SpreadsheetValidationError) {
      return { ok: false, message: error.message };
    }
    const message =
      error instanceof Error ? error.message : formatUnsupportedTypeMessage();
    return { ok: false, message };
  }
}

export function isSpreadsheetFileTooLarge(byteLength: number): boolean {
  return byteLength > SPREADSHEET_FILE_MAX_BYTES;
}

export function isSpreadsheetApiBodyTooLarge(byteLength: number): boolean {
  return byteLength > SPREADSHEET_API_MAX_BODY_BYTES;
}

/** @deprecated Use isSpreadsheetFileTooLarge or isSpreadsheetApiBodyTooLarge */
export function isSpreadsheetUploadPayloadTooLarge(byteLength: number): boolean {
  return isSpreadsheetApiBodyTooLarge(byteLength);
}
