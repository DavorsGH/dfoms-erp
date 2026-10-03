import {
  EMPLOYEE_MISSING_SALARY_RATE_REVIEW_GROUP_LABEL,
  isEmployeeMissingSalaryRateWarning,
} from "@/lib/bulk-import/employee-salary-settings-import-warnings";
import {
  BULK_IMPORT_IGNORE_COLUMN,
  type BulkImportTargetField,
} from "@/lib/bulk-import/types";

export function normalizeColumnMatchKey(value: string): string {
  return value.toLowerCase().replace(/[\s_\-/()]+/g, "");
}

export type BuildAutoColumnMappingOptions = {
  extraAliases?: Map<string, string>;
  skipHeader?: (header: string) => boolean;
  /** Normalized header keys that map to the ignore sentinel. */
  forceIgnoreHeaders?: Set<string>;
};

export function buildAutoColumnMapping(
  headers: string[],
  targetFields: readonly BulkImportTargetField[],
  unmappedValue: string,
  options: BuildAutoColumnMappingOptions = {},
): Record<string, string> {
  const targetKeys = new Set(targetFields.map((field) => field.key));
  const lookup = new Map<string, string>();

  for (const field of targetFields) {
    lookup.set(normalizeColumnMatchKey(field.label), field.key);
    lookup.set(normalizeColumnMatchKey(field.key), field.key);
  }

  if (options.extraAliases) {
    for (const [alias, fieldKey] of options.extraAliases.entries()) {
      if (targetKeys.has(fieldKey)) {
        lookup.set(alias, fieldKey);
      }
    }
  }

  return Object.fromEntries(
    headers.map((header) => {
      const normalizedHeader = normalizeColumnMatchKey(header);

      if (options.forceIgnoreHeaders?.has(normalizedHeader)) {
        return [header, BULK_IMPORT_IGNORE_COLUMN];
      }

      if (options.skipHeader?.(header)) {
        return [header, unmappedValue];
      }

      const matched = lookup.get(normalizedHeader);
      return [header, matched ?? unmappedValue];
    }),
  );
}

export function countRequiredFieldMapping(
  mapping: Record<string, string>,
  targetFields: readonly BulkImportTargetField[],
  unmappedValue: string,
  ignoreColumnValue: string,
): {
  mappedRequired: number;
  totalRequired: number;
  unmappedRequiredFields: BulkImportTargetField[];
} {
  const requiredFields = targetFields.filter((field) => field.required);
  const mappedTargetKeys = new Set(
    Object.values(mapping).filter(
      (value) =>
        value && value !== unmappedValue && value !== ignoreColumnValue,
    ),
  );

  const unmappedRequiredFields = requiredFields.filter(
    (field) => !mappedTargetKeys.has(field.key),
  );

  return {
    mappedRequired: requiredFields.length - unmappedRequiredFields.length,
    totalRequired: requiredFields.length,
    unmappedRequiredFields,
  };
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function downloadBulkImportTemplateCsv(
  targetFields: readonly BulkImportTargetField[],
  fileName: string,
): void {
  const headerRow = targetFields.map((field) => field.label);
  const exampleRow = targetFields.map((field) => field.example);
  const csv = [headerRow, exampleRow]
    .map((row) => row.map((cell) => escapeCsvCell(cell)).join(","))
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function groupIssueRowsByMessage(
  issueRows: Array<{ row_number: number; error_message: string }>,
): Array<{ message: string; count: number }> {
  const counts = new Map<string, number>();

  for (const issue of issueRows) {
    const message = issue.error_message.trim() || "Unknown error";
    counts.set(message, (counts.get(message) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([message, count]) => ({ message, count }))
    .sort((a, b) => b.count - a.count || a.message.localeCompare(b.message));
}

/** Review summary: rolls up missing salary-rate warnings under one label. */
export function groupWarningRowsForReview(
  warningRows: Array<{ row_number: number; error_message: string }>,
): Array<{ message: string; count: number }> {
  const salaryRateWarningCount = warningRows.filter((row) =>
    isEmployeeMissingSalaryRateWarning(row.error_message),
  ).length;

  const otherWarningRows = warningRows.filter(
    (row) => !isEmployeeMissingSalaryRateWarning(row.error_message),
  );

  const groups: Array<{ message: string; count: number }> = [];

  if (salaryRateWarningCount > 0) {
    groups.push({
      message: EMPLOYEE_MISSING_SALARY_RATE_REVIEW_GROUP_LABEL,
      count: salaryRateWarningCount,
    });
  }

  groups.push(...groupIssueRowsByMessage(otherWarningRows));

  return groups.sort(
    (a, b) => b.count - a.count || a.message.localeCompare(b.message),
  );
}

export function downloadBulkImportErrorReportCsv(
  issueRows: Array<{ row_number: number; error_message: string }>,
  fileName: string,
  warningRows: Array<{ row_number: number; error_message: string }> = [],
): void {
  const reportRows = [
    ...issueRows.map((row) => ({
      row_number: row.row_number,
      severity: "error",
      message: row.error_message,
    })),
    ...warningRows.map((row) => ({
      row_number: row.row_number,
      severity: "warning",
      message: row.error_message,
    })),
  ].sort((a, b) => a.row_number - b.row_number);

  const lines = [
    "row_number,severity,message",
    ...reportRows.map(
      (row) =>
        `${row.row_number},${row.severity},${escapeCsvCell(row.message)}`,
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
