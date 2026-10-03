import {
  bulkImportEmployeeDisplayName,
  bulkImportExcelRowNumber,
  bulkImportRowLabel,
  columnHeaderForFieldKey,
  formatBulkImportReviewIssueMessage,
  type BulkImportReviewFormatContext,
  type BulkImportReviewIssue,
} from "@/lib/bulk-import/bulk-import-review-issue";
import { getBulkImportTargetFields } from "@/lib/bulk-import/target-fields";

function issueBase(
  ctx: BulkImportReviewFormatContext,
  mappedData: Record<string, unknown>,
  rowNumber: number,
) {
  const excel_row_number = bulkImportExcelRowNumber(
    rowNumber,
    ctx.headerRowIndex ?? 0,
  );
  const employee_name =
    ctx.importType === "employee"
      ? bulkImportEmployeeDisplayName(mappedData)
      : "";
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

function humanizeLegacyError(message: string, fieldKey: string | null, ctx: BulkImportReviewFormatContext): {
  problem: string;
  howToFix: string;
  column_label: string;
  column_header: string;
} {
  const fieldKeyResolved = fieldKey ?? "unknown";
  const column = fieldKey
    ? columnHeaderForFieldKey(ctx.columnMapping, fieldKey, ctx.importType)
    : { header: "Column", label: "Column" };

  let problem = message;
  let howToFix = "Correct the value in your spreadsheet and re-validate.";

  if (fieldKey && message.includes("must be one of:")) {
    const valueMatch = /^(.+?) must be one of:/i.exec(message);
    const rawLabel = valueMatch?.[1]?.trim() ?? column.label;
    const options = message.split("must be one of:")[1]?.trim() ?? "";
    problem = `${rawLabel} isn't recognised.`;
    howToFix = options ? `Use one of: ${options}.` : howToFix;
  } else if (message.includes(" is required")) {
    problem = `${column.label} is blank.`;
    howToFix = "Enter a value in your spreadsheet and re-validate.";
  } else if (message.includes(" is not a valid date")) {
    problem = `${column.label} isn't a valid date.`;
    howToFix = "Use a date format like DD/MM/YYYY or YYYY-MM-DD.";
  } else if (message.includes(" is not a valid number")) {
    problem = `${column.label} must be a valid number.`;
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
      const friendly = humanizeLegacyError(message, fieldKey, input.ctx);
      const cellValue =
        fieldKey && fieldKey in input.mappedData
          ? String(input.mappedData[fieldKey] ?? "").trim()
          : "";

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
        group_key: `legacy:${message.slice(0, 80)}`,
      });
    }
  }

  return issues;
}
