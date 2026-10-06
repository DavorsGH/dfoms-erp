import {
  bulkImportDateColumnAmbiguousWarningMessage,
  bulkImportDateColumnConflictMessage,
  BULK_IMPORT_DATE_FIELDS_BY_TYPE,
  buildBulkImportDateColumnProfiles,
  parseBulkImportDateWithColumnProfile,
  type BulkImportDateColumnProfile,
} from "@/lib/bulk-import/bulk-import-date-column";
import {
  bulkImportExcelRowNumber,
  bulkImportReviewRowDisplayName,
  bulkImportRowLabel,
  columnHeaderForFieldKey,
  cellDisplayValue,
  formatBulkImportReviewIssueMessage,
  type BulkImportReviewFormatContext,
  type BulkImportReviewIssue,
} from "@/lib/bulk-import/bulk-import-review-issue";
import type { BulkImportType } from "@/lib/bulk-import/types";
import { getBulkImportTargetFields } from "@/lib/bulk-import/target-fields";
import {
  bulkImportFixConfirmDatesBeforeImport,
  bulkImportFixEnterDateUploadAgain,
} from "@/lib/bulk-import/bulk-import-review-wording";

export function bulkImportDateFieldKeysForType(
  importType: BulkImportType,
): readonly string[] {
  return BULK_IMPORT_DATE_FIELDS_BY_TYPE[importType];
}

export function buildDateColumnProfilesForImport(
  importType: BulkImportType,
  mappedRows: Array<Record<string, unknown>>,
): Map<string, BulkImportDateColumnProfile> {
  return buildBulkImportDateColumnProfiles(
    mappedRows,
    bulkImportDateFieldKeysForType(importType),
  );
}

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

export function applyBulkImportDatesToMappedData(input: {
  importType: BulkImportType;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  ctx: BulkImportReviewFormatContext;
  profiles: Map<string, BulkImportDateColumnProfile>;
  requiredFieldKeys: Set<string>;
}): {
  mappedData: Record<string, unknown>;
  issues: BulkImportReviewIssue[];
  legacyErrors: string[];
} {
  const fieldKeys = bulkImportDateFieldKeysForType(input.importType);
  const mappedData = { ...input.mappedData };
  const issues: BulkImportReviewIssue[] = [];
  const legacyErrors: string[] = [];
  const base = issueBase(input.ctx, mappedData, input.rowNumber);

  const fieldLabelByKey = new Map(
    getBulkImportTargetFields(input.importType).map((field) => [
      field.key,
      field.label,
    ]),
  );

  for (const fieldKey of fieldKeys) {
    if (!(fieldKey in mappedData)) {
      continue;
    }

    const profile = input.profiles.get(fieldKey);
    const column = columnHeaderForFieldKey(
      input.ctx.columnMapping,
      fieldKey,
      input.importType,
    );
    const label = fieldLabelByKey.get(fieldKey) ?? column.label;
    const required = input.requiredFieldKeys.has(fieldKey);
    const rawValue = mappedData[fieldKey];
    const parsed = parseBulkImportDateWithColumnProfile(rawValue, profile, {
      required,
    });

    if (parsed.kind === "blank") {
      mappedData[fieldKey] = null;
      continue;
    }

    if (parsed.kind === "iso" || parsed.kind === "ambiguous") {
      mappedData[fieldKey] = parsed.iso;
      if (parsed.kind === "ambiguous") {
        const warningProblem = bulkImportDateColumnAmbiguousWarningMessage(label);
        issues.push({
          row_number: base.row_number,
          excel_row_number: base.excel_row_number,
          employee_name: base.employee_name,
          severity: "warning",
          column_header: column.header,
          column_label: column.label,
          cell_value: cellDisplayValue(rawValue),
          problem: warningProblem,
          how_to_fix: bulkImportFixConfirmDatesBeforeImport(),
          message: formatBulkImportReviewIssueMessage({
            rowLabel: base.row_label,
            severity: "warning",
            problem: warningProblem,
            howToFix: bulkImportFixConfirmDatesBeforeImport(),
          }),
          group_kind: "generic",
          group_key: `date_ambiguous:${fieldKey}`,
        });
      }
      continue;
    }

    if (parsed.kind === "column_conflict") {
      const problem = bulkImportDateColumnConflictMessage(label);
      const howToFix =
        "Use one date format for the entire column or switch to YYYY-MM-DD.";
      issues.push({
        row_number: base.row_number,
        excel_row_number: base.excel_row_number,
        employee_name: base.employee_name,
        severity: "error",
        column_header: column.header,
        column_label: column.label,
        cell_value: cellDisplayValue(rawValue),
        problem,
        how_to_fix: howToFix,
        message: formatBulkImportReviewIssueMessage({
          rowLabel: base.row_label,
          severity: "error",
          problem,
          howToFix,
        }),
        group_kind: "generic",
        group_key: `date_column_conflict:${fieldKey}`,
      });
      legacyErrors.push(`${fieldKey} is not a valid date`);
      continue;
    }

    if (parsed.kind === "out_of_range") {
      legacyErrors.push(`${fieldKey} is outside the allowed date range`);
      continue;
    }

    legacyErrors.push(`${fieldKey} is not a valid date`);
  }

  return { mappedData, issues, legacyErrors };
}

export const BULK_IMPORT_EXPIRATION_BEFORE_MANUFACTURING_GROUP_KEY =
  "date_range:expiration_before_manufacturing";

function formatBulkImportReviewDisplayDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) {
    return iso;
  }
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function rowHasInvalidDateForField(input: {
  fieldKey: string;
  dateReviewIssues: BulkImportReviewIssue[];
  dateLegacyErrors: string[];
}): boolean {
  const prefix = `${input.fieldKey} `;
  if (
    input.dateLegacyErrors.some(
      (message) =>
        message.startsWith(prefix) ||
        message.startsWith(`${input.fieldKey} is`),
    )
  ) {
    return true;
  }

  return input.dateReviewIssues.some(
    (issue) =>
      issue.severity === "error" &&
      (issue.group_key === `date_invalid:${input.fieldKey}` ||
        issue.group_key === `date_column_conflict:${input.fieldKey}` ||
        issue.group_key.startsWith(`date_invalid:${input.fieldKey}:`)),
  );
}

export function collectExpirationBeforeManufacturingReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  dateReviewIssues: BulkImportReviewIssue[];
  dateLegacyErrors: string[];
}): BulkImportReviewIssue | null {
  if (
    rowHasInvalidDateForField({
      fieldKey: "manufacturing_date",
      dateReviewIssues: input.dateReviewIssues,
      dateLegacyErrors: input.dateLegacyErrors,
    }) ||
    rowHasInvalidDateForField({
      fieldKey: "expiration_date",
      dateReviewIssues: input.dateReviewIssues,
      dateLegacyErrors: input.dateLegacyErrors,
    })
  ) {
    return null;
  }

  const manufacturingDate = input.mappedData.manufacturing_date;
  const expirationDate = input.mappedData.expiration_date;

  if (
    typeof manufacturingDate !== "string" ||
    typeof expirationDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manufacturingDate) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate) ||
    expirationDate >= manufacturingDate
  ) {
    return null;
  }

  const base = issueBase(input.ctx, input.mappedData, input.rowNumber);
  const expDisplay = formatBulkImportReviewDisplayDate(expirationDate);
  const mfgDisplay = formatBulkImportReviewDisplayDate(manufacturingDate);
  const problem = `Expiration date (${expDisplay}) is before Manufacturing date (${mfgDisplay}).`;
  const how_to_fix = "Correct the dates and upload the file again.";

  return {
    row_number: base.row_number,
    excel_row_number: base.excel_row_number,
    employee_name: base.employee_name,
    severity: "error",
    column_header: "Expiration date",
    column_label: "Expiration date",
    cell_value: expDisplay,
    problem,
    how_to_fix,
    message: formatBulkImportReviewIssueMessage({
      rowLabel: base.row_label,
      severity: "error",
      problem,
      howToFix: how_to_fix,
    }),
    group_kind: "generic",
    group_key: BULK_IMPORT_EXPIRATION_BEFORE_MANUFACTURING_GROUP_KEY,
  };
}
