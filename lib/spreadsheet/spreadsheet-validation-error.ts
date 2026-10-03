/** User-facing spreadsheet validation failure with alert title + message. */
export class SpreadsheetValidationError extends Error {
  readonly title: string;

  constructor(title: string, message: string) {
    super(message);
    this.name = "SpreadsheetValidationError";
    this.title = title;
  }
}

export const SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE =
  "This file has more than 10,000 rows. Split the file into smaller files.";

export function spreadsheetTooManyDataRowsError(): SpreadsheetValidationError {
  return new SpreadsheetValidationError(
    "Too many rows",
    SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE,
  );
}

export function spreadsheetUnsupportedTypeError(): SpreadsheetValidationError {
  return new SpreadsheetValidationError(
    "This file type isn't supported",
    "Please upload an Excel (.xlsx, .xls) or CSV file.",
  );
}

export function spreadsheetUnreadableError(
  message = "Please check it opens in Excel and try again.",
): SpreadsheetValidationError {
  return new SpreadsheetValidationError("We couldn't read this file", message);
}

export function spreadsheetFileTooLargeError(byteLength: number): SpreadsheetValidationError {
  const mb = (byteLength / (1024 * 1024)).toFixed(1);
  return new SpreadsheetValidationError(
    "This file is too large",
    `Your file is ${mb} MB. The maximum is 20 MB. Please split it into smaller files and upload them one at a time.`,
  );
}

export function spreadsheetEmptyFileError(): SpreadsheetValidationError {
  return spreadsheetUnreadableError("The file is empty.");
}

export function spreadsheetNoWorksheetsError(): SpreadsheetValidationError {
  return spreadsheetUnreadableError("File contains no worksheets.");
}
