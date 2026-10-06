import {
  bulkImportExcelRowNumber,
  bulkImportReviewRowDisplayName,
  bulkImportRowLabel,
  columnHeaderForFieldKey,
  formatBulkImportReviewIssueMessage,
  type BulkImportReviewFormatContext,
  type BulkImportReviewIssue,
} from "@/lib/bulk-import/bulk-import-review-issue";
import { getBulkImportTargetFields } from "@/lib/bulk-import/target-fields";
import { resolveLegacyReviewGroupKey } from "@/lib/bulk-import/bulk-import-legacy-review-group-key";
import {
  BULK_IMPORT_FIX_UPLOAD_AGAIN,
  bulkImportFixEnterDateUploadAgain,
  bulkImportFixEnterNumberUploadAgain,
  bulkImportFixEnterSmallerValueUploadAgain,
  bulkImportFixEnterValueUploadAgain,
  bulkImportFixReduceDecimalsUploadAgain,
  bulkImportProblemWithQuotedValue,
} from "@/lib/bulk-import/bulk-import-review-wording";

function issueBase(
  ctx: BulkImportReviewFormatContext,
  mappedData: Record<string, unknown>,
  rowNumber: number,
) {
  const excel_row_number = bulkImportExcelRowNumber(
    rowNumber,
    ctx.headerRowIndex ?? 0,
  );
  const employee_name = bulkImportReviewRowDisplayName(
    ctx.importType,
    mappedData,
  );
  return {
    row_number: rowNumber,
    excel_row_number,
    employee_name,
    row_label: bulkImportRowLabel({
      excelRowNumber: excel_row_number,
      employeeName: employee_name,
    }),
  };
}

function inferFieldKeyFromMessage(
  message: string,
  importType: BulkImportReviewFormatContext["importType"],
): string | null {
  const normalized = message.toLowerCase();
  for (const field of getBulkImportTargetFields(importType)) {
    if (
      normalized.startsWith(`${field.key.toLowerCase()} `) ||
      normalized.startsWith(`${field.label.toLowerCase()} `) ||
      normalized.includes(` ${field.key.toLowerCase()} `)
    ) {
      return field.key;
    }
  }

  return null;
}

function humanizeLegacyError(
  message: string,
  fieldKey: string | null,
  ctx: BulkImportReviewFormatContext,
  cellValue: string,
): {
  problem: string;
  howToFix: string;
  column_label: string;
  column_header: string;
} {
  const column = fieldKey
    ? columnHeaderForFieldKey(ctx.columnMapping, fieldKey, ctx.importType)
    : { header: "Column", label: "Column" };

  let problem = message;
  let howToFix = BULK_IMPORT_FIX_UPLOAD_AGAIN;

  if (fieldKey && message.includes("must be one of:")) {
    const valueMatch = /^(.+?) must be one of:/i.exec(message);
    const rawLabel = valueMatch?.[1]?.trim() ?? column.label;
    const options = message.split("must be one of:")[1]?.trim() ?? "";
    problem = bulkImportProblemWithQuotedValue(rawLabel, cellValue, "isn't recognised.");
    howToFix = options
      ? `${options}. Upload the file again.`
      : BULK_IMPORT_FIX_UPLOAD_AGAIN;
  } else if (message.includes(" is required")) {
    problem = `${column.label} is blank.`;
    howToFix = bulkImportFixEnterValueUploadAgain();
  } else if (message.includes(" is not a valid date")) {
    problem = bulkImportProblemWithQuotedValue(
      column.label,
      cellValue,
      "isn't a valid date.",
    );
    howToFix = bulkImportFixEnterDateUploadAgain();
  } else if (
    message.includes("must be a valid number") ||
    message.includes(" is not a valid number")
  ) {
    problem = bulkImportProblemWithQuotedValue(
      column.label,
      cellValue,
      "isn't a number.",
    );
    howToFix = bulkImportFixEnterNumberUploadAgain();
  } else if (/^duplicate\s+[\w]+:\s*repeated in this file/i.test(message)) {
    const match = /^duplicate\s+([\w]+):\s*repeated in this file/i.exec(message);
    const legacyFieldKey = match?.[1] ?? fieldKey;
    const legacyColumn = legacyFieldKey
      ? columnHeaderForFieldKey(ctx.columnMapping, legacyFieldKey, ctx.importType)
      : column;
    problem = `${legacyColumn.label} appears more than once in this file.`;
    howToFix =
      legacyFieldKey === "product_code"
        ? "Each product needs its own code."
        : legacyFieldKey === "barcode"
          ? "Each product needs its own barcode."
          : "Each row needs a unique value in this column.";
  } else if (message.includes("must have at most")) {
    problem = bulkImportProblemWithQuotedValue(
      column.label,
      cellValue,
      "has too many decimal places.",
    );
    howToFix = bulkImportFixReduceDecimalsUploadAgain();
  } else if (message.includes("is too large")) {
    problem = bulkImportProblemWithQuotedValue(
      column.label,
      cellValue,
      "is too large.",
    );
    howToFix = bulkImportFixEnterSmallerValueUploadAgain();
  } else if (
    message.includes("is not a valid date") ||
    message.includes("is outside the allowed date range")
  ) {
    problem = bulkImportProblemWithQuotedValue(
      column.label,
      cellValue,
      "wasn't recognised as a date.",
    );
    howToFix = bulkImportFixEnterDateUploadAgain();
  } else if (fieldKey) {
    problem = message.replace(new RegExp(`^${fieldKey}\\b`, "i"), column.label);
    problem = problem.replace(new RegExp(`^${fieldKey.replace(/_/g, " ")}`, "i"), column.label);
  }

  return {
    problem,
    howToFix,
    column_label: column.label,
    column_header: column.header,
  };
}

export function reviewIssuesFromLegacyErrorMessages(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  messages: string[];
  severity: BulkImportReviewIssue["severity"];
  group_kind?: BulkImportReviewIssue["group_kind"];
}): BulkImportReviewIssue[] {
  const issues: BulkImportReviewIssue[] = [];
  const base = issueBase(input.ctx, input.mappedData, input.rowNumber);

  for (const rawMessage of input.messages) {
    const parts = rawMessage
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);

    for (const message of parts) {
      const fieldKey = inferFieldKeyFromMessage(message, input.ctx.importType);
      const cellValue =
        fieldKey && fieldKey in input.mappedData
          ? String(input.mappedData[fieldKey] ?? "").trim()
          : "";
      const friendly = humanizeLegacyError(
        message,
        fieldKey,
        input.ctx,
        cellValue,
      );

      issues.push({
        row_number: base.row_number,
        excel_row_number: base.excel_row_number,
        employee_name: base.employee_name,
        severity: input.severity,
        column_header: friendly.column_header,
        column_label: friendly.column_label,
        cell_value: cellValue,
        problem: friendly.problem,
        how_to_fix: friendly.howToFix,
        message: formatBulkImportReviewIssueMessage({
          rowLabel: base.row_label,
          severity: input.severity,
          problem: friendly.problem,
          howToFix: friendly.howToFix,
        }),
        group_kind: input.group_kind ?? "generic",
        group_key: resolveLegacyReviewGroupKey({
          message,
          fieldKey,
          importType: input.ctx.importType,
        }),
      });
    }
  }

  return issues;
}
