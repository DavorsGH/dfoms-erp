import {
  getSpreadsheetExtension,
  SPREADSHEET_UPLOAD_MAX_BYTES,
} from "@/lib/spreadsheet/spreadsheet-upload-validation";
import {
  SpreadsheetValidationError,
  SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE,
} from "@/lib/spreadsheet/spreadsheet-validation-error";

export type SpreadsheetImportAlert = {
  title: string;
  message: string;
};

export function spreadsheetImportTooLargeAlert(
  byteLength: number,
): SpreadsheetImportAlert {
  const mb = (byteLength / (1024 * 1024)).toFixed(1);
  return {
    title: "This file is too large",
    message: `Your file is ${mb} MB. The maximum is 20 MB. Please split it into smaller files and upload them one at a time.`,
  };
}

export function spreadsheetImportWrongTypeAlert(): SpreadsheetImportAlert {
  return {
    title: "This file type isn't supported",
    message: "Please upload an Excel (.xlsx, .xls) or CSV file.",
  };
}

export function spreadsheetImportUnreadableAlert(): SpreadsheetImportAlert {
  return {
    title: "We couldn't read this file",
    message: "Please check it opens in Excel and try again.",
  };
}

export function spreadsheetImportUploadFailedAlert(): SpreadsheetImportAlert {
  return {
    title: "Upload failed",
    message:
      "Something went wrong uploading your file. Please try again.",
  };
}

export function inspectSpreadsheetFileForImport(
  file: File,
): { ok: true } | { ok: false; alert: SpreadsheetImportAlert } {
  if (file.size > SPREADSHEET_UPLOAD_MAX_BYTES) {
    return { ok: false, alert: spreadsheetImportTooLargeAlert(file.size) };
  }

  const extension = getSpreadsheetExtension(file.name);
  if (!extension) {
    return { ok: false, alert: spreadsheetImportWrongTypeAlert() };
  }

  const mimeType = file.type.trim().toLowerCase();
  if (
    mimeType &&
    mimeType !== "application/octet-stream" &&
    mimeType !== "binary/octet-stream"
  ) {
    const csvMimes = ["text/csv", "application/csv", "text/plain"];
    const xlsxMimes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    const xlsMimes = [
      "application/vnd.ms-excel",
      "application/msexcel",
      "application/vnd.ms-office",
    ];

    const allowed =
      extension === "csv"
        ? csvMimes
        : extension === "xlsx"
          ? xlsxMimes
          : xlsMimes;

    if (!allowed.includes(mimeType)) {
      return { ok: false, alert: spreadsheetImportWrongTypeAlert() };
    }
  }

  return { ok: true };
}

function isUnreadableSpreadsheetMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("could not read") ||
    normalized.includes("no worksheets") ||
    normalized.includes("file is empty")
  );
}

function isWrongTypeSpreadsheetMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("unsupported file type") ||
    normalized.includes("isn't supported")
  );
}

function isTooLargeSpreadsheetMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("too large") ||
    normalized.includes("maximum is 20 mb") ||
    normalized.includes("limit is 20 mb") ||
    normalized.includes("maximum is 4 mb") ||
    normalized.includes("limit is 4 mb") ||
    normalized.includes("entity too large")
  );
}

export function spreadsheetImportTooManyRowsAlert(): SpreadsheetImportAlert {
  return {
    title: "Too many rows",
    message: SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE,
  };
}

export function spreadsheetImportAlertFromError(
  error: unknown,
  context: "upload" | "parse" = "upload",
): SpreadsheetImportAlert {
  if (error instanceof SpreadsheetValidationError) {
    return { title: error.title, message: error.message };
  }

  const message = error instanceof Error ? error.message : String(error ?? "");

  if (isTooLargeSpreadsheetMessage(message)) {
    const mbMatch = /([\d.]+)\s*mb/i.exec(message);
    const bytes = mbMatch ? Number.parseFloat(mbMatch[1]) * 1024 * 1024 : 0;
    return spreadsheetImportTooLargeAlert(
      bytes > SPREADSHEET_UPLOAD_MAX_BYTES ? bytes : SPREADSHEET_UPLOAD_MAX_BYTES + 1,
    );
  }

  if (
    message.includes("10,000 rows") ||
    message === SPREADSHEET_TOO_MANY_DATA_ROWS_MESSAGE
  ) {
    return spreadsheetImportTooManyRowsAlert();
  }

  if (isWrongTypeSpreadsheetMessage(message)) {
    return spreadsheetImportWrongTypeAlert();
  }

  if (isUnreadableSpreadsheetMessage(message)) {
    return spreadsheetImportUnreadableAlert();
  }

  if (context === "parse") {
    return spreadsheetImportUnreadableAlert();
  }

  if (message.trim()) {
    return {
      title: "Upload failed",
      message: message.trim(),
    };
  }

  return spreadsheetImportUploadFailedAlert();
}

export async function spreadsheetImportAlertFromUploadResponse(
  response: Response,
): Promise<SpreadsheetImportAlert> {
  if (response.status === 413) {
    return spreadsheetImportTooLargeAlert(SPREADSHEET_UPLOAD_MAX_BYTES + 1);
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    const bodyText = await response.text().catch(() => "");
    console.error("Spreadsheet upload non-JSON response", {
      status: response.status,
      contentType,
      body: bodyText.slice(0, 500),
    });

    if (
      response.status === 413 ||
      bodyText.toLowerCase().includes("entity too large")
    ) {
      return spreadsheetImportTooLargeAlert(SPREADSHEET_UPLOAD_MAX_BYTES + 1);
    }

    return spreadsheetImportUploadFailedAlert();
  }

  let payload: { error?: string } | null = null;
  try {
    payload = (await response.json()) as { error?: string };
  } catch (parseError) {
    console.error("Spreadsheet upload JSON parse failed", parseError);
    return spreadsheetImportUploadFailedAlert();
  }

  console.error("Spreadsheet upload API error", {
    status: response.status,
    error: payload?.error,
  });

  if (response.status === 413) {
    return spreadsheetImportTooLargeAlert(SPREADSHEET_UPLOAD_MAX_BYTES + 1);
  }

  if (payload?.error) {
    return spreadsheetImportAlertFromError(new Error(payload.error), "upload");
  }

  return spreadsheetImportUploadFailedAlert();
}

export async function readSpreadsheetImportJsonResponse<T>(
  response: Response,
): Promise<
  { ok: true; data: T } | { ok: false; alert: SpreadsheetImportAlert }
> {
  if (!response.ok) {
    return {
      ok: false,
      alert: await spreadsheetImportAlertFromUploadResponse(response),
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const bodyText = await response.text().catch(() => "");
    console.error("Spreadsheet import non-JSON success response", {
      status: response.status,
      contentType,
      body: bodyText.slice(0, 500),
    });
    return { ok: false, alert: spreadsheetImportUploadFailedAlert() };
  }

  try {
    const data = (await response.json()) as T;
    return { ok: true, data };
  } catch (parseError) {
    console.error("Spreadsheet import JSON parse failed", parseError);
    return { ok: false, alert: spreadsheetImportUploadFailedAlert() };
  }
}
