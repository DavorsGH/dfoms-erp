import type { BulkImportColumnMapping, BulkImportType } from "@/lib/bulk-import/types";
import { getBulkImportTargetField } from "@/lib/bulk-import/target-fields";
import { readBulkImportHeaderRowIndex } from "@/lib/bulk-import/column-mapping-meta";

export type BulkImportReviewIssueSeverity = "error" | "warning";

export type BulkImportReviewIssueGroupKind =
  | "salary_rate"
  | "contract_project"
  | "shift_placeholder"
  | "generic";

export type BulkImportReviewIssue = {
  row_number: number;
  excel_row_number: number;
  employee_name: string;
  severity: BulkImportReviewIssueSeverity;
  column_header: string;
  column_label: string;
  cell_value: string;
  problem: string;
  how_to_fix: string;
  message: string;
  group_kind: BulkImportReviewIssueGroupKind;
  group_key: string;
  /** Spreadsheet position title not in tenant (salary / import messaging). */
  unknown_position_title?: string;
  /** Shift cell treated as blank (e.g. "Not Assigned"). */
  shift_placeholder_source?: string;
};

export type BulkImportReviewIssueRow = BulkImportReviewIssue & {
  /** @deprecated Use message */
  error_message: string;
};

export function bulkImportExcelRowNumber(
  dataRowNumber: number,
  headerRowIndex: number,
): number {
  return headerRowIndex + 1 + dataRowNumber;
}

export function bulkImportEmployeeDisplayName(
  mappedData: Record<string, unknown>,
): string {
  const name = String(mappedData.full_name ?? "").trim();
  return name;
}

export function bulkImportRowLabel(input: {
  excelRowNumber: number;
  employeeName: string;
}): string {
  if (input.employeeName) {
    return `Row ${input.excelRowNumber} · ${input.employeeName}`;
  }

  return `Row ${input.excelRowNumber}`;
}

export function columnHeaderForFieldKey(
  columnMapping: BulkImportColumnMapping,
  fieldKey: string,
  importType: BulkImportType,
): { header: string; label: string } {
  for (const [header, target] of Object.entries(columnMapping)) {
    if (target === fieldKey) {
      const field = getBulkImportTargetField(importType, fieldKey);
      return {
        header,
        label: field?.label ?? humanizeFieldKey(fieldKey),
      };
    }
  }

  const field = getBulkImportTargetField(importType, fieldKey);
  return {
    header: field?.label ?? humanizeFieldKey(fieldKey),
    label: field?.label ?? humanizeFieldKey(fieldKey),
  };
}

function humanizeFieldKey(fieldKey: string): string {
  return fieldKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatBulkImportReviewIssueMessage(input: {
  rowLabel: string;
  severity: BulkImportReviewIssueSeverity;
  problem: string;
  howToFix: string;
}): string {
  const prefix = input.severity === "error" ? "Error" : "Warning";
  const problem = input.problem.trim();
  const fix = input.howToFix.trim();
  if (fix) {
    return `${prefix}: ${input.rowLabel}: ${problem} ${fix}`.trim();
  }

  return `${prefix}: ${input.rowLabel}: ${problem}`.trim();
}

export function toReviewIssueRow(issue: BulkImportReviewIssue): BulkImportReviewIssueRow {
  return {
    ...issue,
    error_message: issue.message,
  };
}

export type BulkImportReviewFormatContext = {
  importType: BulkImportType;
  columnMapping: BulkImportColumnMapping;
  headerRowIndex?: number;
};

export function buildReviewFormatContext(input: {
  importType: BulkImportType;
  columnMapping: BulkImportColumnMapping;
}): BulkImportReviewFormatContext {
  return {
    importType: input.importType,
    columnMapping: input.columnMapping,
    headerRowIndex: readBulkImportHeaderRowIndex(input.columnMapping),
  };
}

export function cellDisplayValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

export type BulkImportReviewIssueGroup = {
  group_key: string;
  group_kind: BulkImportReviewIssueGroupKind;
  headline: string;
  body: string;
  count: number;
  examples: BulkImportReviewIssue[];
};

export function groupBulkImportReviewIssues(
  issues: BulkImportReviewIssue[],
  importType: BulkImportType,
): BulkImportReviewIssueGroup[] {
  const byKey = new Map<string, BulkImportReviewIssue[]>();

  for (const issue of issues) {
    const list = byKey.get(issue.group_key) ?? [];
    list.push(issue);
    byKey.set(issue.group_key, list);
  }

  const groups: BulkImportReviewIssueGroup[] = [];

  for (const [group_key, rows] of byKey.entries()) {
    const kind = rows[0]?.group_kind ?? "generic";
    const genericHeadline =
      kind === "generic"
        ? genericGroupHeadlineFromKey(group_key, rows.length, importType)
        : null;
    groups.push({
      group_key,
      group_kind: kind,
      headline:
        genericHeadline ??
        buildGroupHeadline(kind, rows.length, importType),
      body: buildGroupBody(kind, rows, importType, group_key),
      count: rows.length,
      examples: rows.slice(0, 3),
    });
  }

  return groups.sort((a, b) => b.count - a.count || a.headline.localeCompare(b.headline));
}

function buildGroupHeadline(
  kind: BulkImportReviewIssueGroupKind,
  count: number,
  importType: BulkImportType,
): string {
  const noun =
    importType === "employee"
      ? count === 1
        ? "employee"
        : "employees"
      : count === 1
        ? "row"
        : "rows";

  if (kind === "salary_rate") {
    return `${count} ${noun} have no salary rate yet`;
  }

  if (kind === "contract_project") {
    return `${count} ${noun}' Contract/Project wasn't found`;
  }

  if (kind === "shift_placeholder") {
    return count === 1
      ? "1 row has Shift treated as blank"
      : `${count} rows have Shift treated as blank`;
  }

  return count === 1 ? "1 row needs attention" : `${count} rows need attention`;
}

function genericGroupHeadlineFromKey(
  groupKey: string,
  count: number,
  importType: BulkImportType,
): string | null {
  const rowSuffix = count === 1 ? "1 row" : `${count} rows`;

  if (groupKey.startsWith("enum:")) {
    const fieldKey = groupKey.slice("enum:".length);
    const field = getBulkImportTargetField(importType, fieldKey);
    const label = field?.label ?? humanizeFieldKey(fieldKey);
    return `${label} not recognised — ${rowSuffix}`;
  }

  if (groupKey.startsWith("required:")) {
    const fieldKey = groupKey.slice("required:".length);
    const field = getBulkImportTargetField(importType, fieldKey);
    const label = field?.label ?? humanizeFieldKey(fieldKey);
    return `${label} is blank — ${rowSuffix}`;
  }

  if (groupKey === "staff_id_exists") {
    return `Staff ID already in use — ${rowSuffix}`;
  }

  if (groupKey === "staff_id_duplicate_file") {
    return `Duplicate staff ID in file — ${rowSuffix}`;
  }

  if (groupKey.startsWith("lookup_ambiguous:")) {
    const fieldKey = groupKey.slice("lookup_ambiguous:".length);
    const field = getBulkImportTargetField(importType, fieldKey);
    const label = field?.label ?? humanizeFieldKey(fieldKey);
    return `${label} matches multiple records — ${rowSuffix}`;
  }

  if (groupKey.startsWith("date_invalid:") || groupKey.startsWith("date_range:")) {
    const fieldKey = groupKey.split(":")[1] ?? "date";
    const field = getBulkImportTargetField(importType, fieldKey);
    const label = field?.label ?? humanizeFieldKey(fieldKey);
    return `${label} date problem — ${rowSuffix}`;
  }

  return null;
}

function buildGroupBody(
  kind: BulkImportReviewIssueGroupKind,
  rows: BulkImportReviewIssue[],
  importType: BulkImportType,
  groupKey: string,
): string {
  if (kind === "generic" && groupKey.startsWith("enum:")) {
    return "Check the example rows below and fix values in your spreadsheet.";
  }
  if (kind === "salary_rate" && importType === "employee") {
    const example = rows.find((row) => row.cell_value.includes("·"));
    const comboHint = example?.cell_value
      ? ` (e.g. ${example.cell_value})`
      : " (e.g. Cleaner · Casual · Morning)";
    return `Their position, employment type and shift${comboHint} have no rate in Salary Settings, so they'll be imported with no pay until a rate is added.`;
  }

  if (kind === "contract_project") {
    const valueExample =
      rows.find((row) => row.cell_value)?.cell_value ?? rows[0]?.cell_value ?? "";
    const quoted = valueExample ? ` "${valueExample}"` : "";
    return `e.g.${quoted}. They'll be imported with no contract assigned. Create the project first and re-upload, or assign it later.`;
  }

  if (kind === "shift_placeholder") {
    return "These shifts will be stored blank on import. Add a salary rate after import if needed.";
  }

  return rows[0]?.how_to_fix ?? rows[0]?.problem ?? "";
}

export function resolveReviewIssueMessageForDisplay(
  issue: BulkImportReviewIssue,
  options: { createMissingPositions: boolean },
): string {
  if (issue.unknown_position_title && issue.group_kind === "salary_rate") {
    const rowLabel = bulkImportRowLabel({
      excelRowNumber: issue.excel_row_number,
      employeeName: issue.employee_name,
    });
    const title = issue.unknown_position_title;
    if (options.createMissingPositions) {
      return formatBulkImportReviewIssueMessage({
        rowLabel,
        severity: issue.severity,
        problem: `Position "${title}" will be created on import. No salary rate exists for it yet, so this employee will have no pay until a rate is added in Salary Settings.`,
        howToFix: "",
      });
    }

    return formatBulkImportReviewIssueMessage({
      rowLabel,
      severity: issue.severity,
      problem: `Position "${title}" wasn't found and won't be created, so it will be left blank. No salary rate can be matched, so this employee will have no pay until a position and rate are set.`,
      howToFix: "",
    });
  }

  return issue.message;
}

export function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function downloadBulkImportReviewReportCsv(
  issues: BulkImportReviewIssue[],
  fileName: string,
): void {
  const lines = [
    "Excel Row,Employee Name,Severity,Column,Value,Problem,How to fix",
    ...issues
      .slice()
      .sort(
        (a, b) =>
          a.excel_row_number - b.excel_row_number ||
          a.severity.localeCompare(b.severity),
      )
      .map((issue) =>
        [
          issue.excel_row_number,
          escapeCsvCell(issue.employee_name),
          issue.severity === "error" ? "Error" : "Warning",
          escapeCsvCell(issue.column_label || issue.column_header),
          escapeCsvCell(issue.cell_value),
          escapeCsvCell(issue.problem),
          escapeCsvCell(issue.how_to_fix),
        ].join(","),
      ),
  ];

  const blob = new Blob([lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
