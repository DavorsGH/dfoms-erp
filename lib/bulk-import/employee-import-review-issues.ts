import {
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  SHIFT_OPTIONS,
} from "@/app/dashboard/employees/employee-record-utils";
import { resolveEmployeeCompensation } from "@/app/dashboard/administration/compensation-policy-utils";
import type { PayrollCompensationPolicyConfig } from "@/app/dashboard/hr-payroll/payroll-processing-utils";
import {
  bulkImportEmployeeDisplayName,
  bulkImportExcelRowNumber,
  bulkImportRowLabel,
  cellDisplayValue,
  columnHeaderForFieldKey,
  formatBulkImportReviewIssueMessage,
  type BulkImportReviewFormatContext,
  type BulkImportReviewIssue,
} from "@/lib/bulk-import/bulk-import-review-issue";
import { getBulkImportTargetFields } from "@/lib/bulk-import/target-fields";
import {
  normalizeTenantLookupKey,
  validateTenantNameLookup,
} from "@/lib/bulk-import/tenant-name-lookup";
import { normalizeEmployeeImportShift } from "@/lib/bulk-import/employee-shift-import";
import {
  buildInFileDuplicateReviewIssue,
  bulkImportNormalizedDuplicateKey,
  type InFileDuplicateGroupInfo,
} from "@/lib/bulk-import/bulk-import-in-file-duplicate-issues";
import type { EmployeeImportLookupContext } from "@/lib/bulk-import/validate-import-rows";

const SALARY_GROUP_KEY = "salary_rate";
const CONTRACT_GROUP_KEY = "contract_project";

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return String(value).trim() === "";
}

function issueBase(
  ctx: BulkImportReviewFormatContext,
  mappedData: Record<string, unknown>,
  rowNumber: number,
): {
  row_number: number;
  excel_row_number: number;
  employee_name: string;
  row_label: string;
} {
  const headerRowIndex = ctx.headerRowIndex ?? 0;
  const excel_row_number = bulkImportExcelRowNumber(rowNumber, headerRowIndex);
  const employee_name = bulkImportEmployeeDisplayName(mappedData);
  return {
    row_number: rowNumber,
    excel_row_number,
    employee_name,
    row_label: bulkImportRowLabel({ excelRowNumber: excel_row_number, employeeName: employee_name }),
  };
}

function makeIssue(
  ctx: BulkImportReviewFormatContext,
  mappedData: Record<string, unknown>,
  rowNumber: number,
  input: {
    severity: BulkImportReviewIssue["severity"];
    fieldKey: string;
    cellValue: unknown;
    problem: string;
    howToFix: string;
    group_kind: BulkImportReviewIssue["group_kind"];
    group_key: string;
    unknown_position_title?: string;
    shift_placeholder_source?: string;
  },
): BulkImportReviewIssue {
  const base = issueBase(ctx, mappedData, rowNumber);
  const column = columnHeaderForFieldKey(ctx.columnMapping, input.fieldKey, ctx.importType);
  const message = formatBulkImportReviewIssueMessage({
    rowLabel: base.row_label,
    severity: input.severity,
    problem: input.problem,
    howToFix: input.howToFix,
  });

  return {
    row_number: base.row_number,
    excel_row_number: base.excel_row_number,
    employee_name: base.employee_name,
    severity: input.severity,
    column_header: column.header,
    column_label: column.label,
    cell_value: cellDisplayValue(input.cellValue),
    problem: input.problem,
    how_to_fix: input.howToFix,
    message,
    group_kind: input.group_kind,
    group_key: input.group_key,
    unknown_position_title: input.unknown_position_title,
    shift_placeholder_source: input.shift_placeholder_source,
  };
}

function resolveEmployeePositionTitleForSalaryCheck(
  mappedData: Record<string, unknown>,
  employeeLookups: EmployeeImportLookupContext,
): { canonical: string | null; raw: string } {
  const raw = String(mappedData.position_title ?? "").trim();
  if (!raw) {
    return { canonical: null, raw: "" };
  }

  const key = normalizeTenantLookupKey(raw);
  const count = employeeLookups.positionTitleMatchCounts.get(key) ?? 0;
  if (count !== 1) {
    return { canonical: null, raw };
  }

  return {
    canonical: employeeLookups.positionTitleByLookupKey.get(key) ?? raw,
    raw,
  };
}

export function collectEmployeeImportReviewIssues(input: {
  mappedData: Record<string, unknown>;
  rowNumber: number;
  ctx: BulkImportReviewFormatContext;
  employeeLookups: EmployeeImportLookupContext;
  compensationPolicyConfig: PayrollCompensationPolicyConfig | null | undefined;
  inFileDuplicateStaffIdGroups: Map<string, InFileDuplicateGroupInfo>;
}): BulkImportReviewIssue[] {
  const {
    mappedData,
    rowNumber,
    ctx,
    employeeLookups,
    compensationPolicyConfig,
    inFileDuplicateStaffIdGroups,
  } = input;

  const issues: BulkImportReviewIssue[] = [];
  const normalizedShift = normalizeEmployeeImportShift(mappedData.shift);

  if ("shift" in mappedData && normalizedShift.placeholderSource) {
    const column = columnHeaderForFieldKey(ctx.columnMapping, "shift", ctx.importType);
    issues.push(
      makeIssue(ctx, mappedData, rowNumber, {
        severity: "warning",
        fieldKey: "shift",
        cellValue: normalizedShift.placeholderSource,
        problem: `${column.label} is "${normalizedShift.placeholderSource}", so it will be left blank and no salary rate can be matched.`,
        howToFix:
          "Update the shift in your spreadsheet or add a salary rate after import if needed.",
        group_kind: "shift_placeholder",
        group_key: "shift_placeholder",
        shift_placeholder_source: normalizedShift.placeholderSource,
      }),
    );
  }

  for (const field of getBulkImportTargetFields("employee")) {
    if (field.required && isBlank(mappedData[field.key])) {
      issues.push(
        makeIssue(ctx, mappedData, rowNumber, {
          severity: "error",
          fieldKey: field.key,
          cellValue: mappedData[field.key],
          problem: `${field.label} is blank.`,
          howToFix: "Enter a value in your spreadsheet and upload the file again.",
          group_kind: "generic",
          group_key: `required:${field.key}`,
        }),
      );
    }
  }

  const enumChecks: Array<[string, readonly string[], string]> = [
    ["employment_type", EMPLOYMENT_TYPE_OPTIONS, "Use Casual, Part-Time, Full-Time or Contract."],
    ["employment_status", EMPLOYMENT_STATUS_OPTIONS, "Use Active, Inactive or Terminated."],
    ["gender", GENDER_OPTIONS, "Use a supported gender value from the template."],
    ["marital_status", MARITAL_STATUS_OPTIONS, "Use a supported marital status from the template."],
    ["shift", SHIFT_OPTIONS, "Use Full Day, Morning, Afternoon, Night or Rotating."],
  ];

  for (const [fieldKey, allowedValues, fixHint] of enumChecks) {
    if (!(fieldKey in mappedData)) {
      continue;
    }

    const trimmed =
      fieldKey === "shift"
        ? normalizedShift.effectiveValue
        : String(mappedData[fieldKey]).trim();
    if (!trimmed) {
      continue;
    }
    const match = allowedValues.find(
      (option) => option.toLowerCase() === trimmed.toLowerCase(),
    );
    if (!match) {
      const column = columnHeaderForFieldKey(ctx.columnMapping, fieldKey, ctx.importType);
      issues.push(
        makeIssue(ctx, mappedData, rowNumber, {
          severity: "error",
          fieldKey,
          cellValue: mappedData[fieldKey],
          problem: `${column.label} "${trimmed}" isn't recognised.`,
          howToFix: fixHint,
          group_kind: "generic",
          group_key: `enum:${fieldKey}`,
        }),
      );
    }
  }

  const nameLookups: Array<[string, Map<string, number>, string]> = [
    ["department_name", employeeLookups.departmentNameMatchCounts, "departments"],
    ["position_title", employeeLookups.positionTitleMatchCounts, "positions"],
    ["supervisor_name", employeeLookups.supervisorNameMatchCounts, "employees"],
    ["assigned_site_name", employeeLookups.assignedSiteNameMatchCounts, "sites"],
  ];

  for (const [fieldKey, matchCounts, entityLabel] of nameLookups) {
    if (!(fieldKey in mappedData) || isBlank(mappedData[fieldKey])) {
      continue;
    }

    const lookupError = validateTenantNameLookup(
      mappedData[fieldKey],
      matchCounts,
      fieldKey,
      entityLabel,
    );
    if (lookupError) {
      const column = columnHeaderForFieldKey(ctx.columnMapping, fieldKey, ctx.importType);
      issues.push(
        makeIssue(ctx, mappedData, rowNumber, {
          severity: "error",
          fieldKey,
          cellValue: mappedData[fieldKey],
          problem: `${column.label} "${cellDisplayValue(mappedData[fieldKey])}" matches multiple ${entityLabel}.`,
          howToFix: "Use a more specific name or fix duplicates in your workspace.",
          group_kind: "generic",
          group_key: `lookup_ambiguous:${fieldKey}`,
        }),
      );
    }
  }

  if ("staff_id" in mappedData && !isBlank(mappedData.staff_id)) {
    const staffKey = String(mappedData.staff_id).trim().toLowerCase();
    if (employeeLookups.existingStaffIds.has(staffKey)) {
      issues.push(
        makeIssue(ctx, mappedData, rowNumber, {
          severity: "error",
          fieldKey: "staff_id",
          cellValue: mappedData.staff_id,
          problem: `Staff ID "${cellDisplayValue(mappedData.staff_id)}" is already used in this workspace.`,
          howToFix: "Use a unique staff ID or leave the employee out of this import.",
          group_kind: "generic",
          group_key: "staff_id_exists",
        }),
      );
    }

    const staffDuplicateGroup = inFileDuplicateStaffIdGroups.get(staffKey);
    if (staffDuplicateGroup) {
      issues.push(
        buildInFileDuplicateReviewIssue({
          ctx,
          mappedData,
          rowNumber,
          fieldKey: "staff_id",
          group: staffDuplicateGroup,
          severity: "error",
        }),
      );
    }
  }

  if ("contract_project_name" in mappedData && !isBlank(mappedData.contract_project_name)) {
    const key = normalizeTenantLookupKey(mappedData.contract_project_name);
    const count = employeeLookups.contractProjectNameMatchCounts.get(key) ?? 0;
    if (count === 0) {
      issues.push(
        makeIssue(ctx, mappedData, rowNumber, {
          severity: "warning",
          fieldKey: "contract_project_name",
          cellValue: mappedData.contract_project_name,
          problem: `Contract/Project "${cellDisplayValue(mappedData.contract_project_name)}" wasn't found.`,
          howToFix:
            "They'll be imported with no contract assigned. Create the project first and upload the file again, or assign it later.",
          group_kind: "contract_project",
          group_key: CONTRACT_GROUP_KEY,
        }),
      );
    }
  }

  if (compensationPolicyConfig) {
    const { canonical: position, raw: rawPosition } =
      resolveEmployeePositionTitleForSalaryCheck(mappedData, employeeLookups);
    const employmentType = String(mappedData.employment_type ?? "").trim();
    const shift = normalizedShift.effectiveValue;
    const unknownPosition =
      Boolean(rawPosition) &&
      !position &&
      (employeeLookups.positionTitleMatchCounts.get(
        normalizeTenantLookupKey(rawPosition),
      ) ?? 0) === 0;

    if (unknownPosition && rawPosition) {
      issues.push(
        makeIssue(ctx, mappedData, rowNumber, {
          severity: "warning",
          fieldKey: "basic_salary",
          cellValue: [rawPosition, employmentType, shift].filter(Boolean).join(" · "),
          problem: `Position "${rawPosition}" will be created on import. No salary rate exists for it yet, so this employee will have no pay until a rate is added in Salary Settings.`,
          howToFix: "",
          group_kind: "salary_rate",
          group_key: SALARY_GROUP_KEY,
          unknown_position_title: rawPosition,
        }),
      );
    } else {
      const missingParts: string[] = [];
      if (!position) {
        if (rawPosition) {
          missingParts.push(`Position "${rawPosition}" isn't recognised`);
        } else {
          missingParts.push("Position is blank");
        }
      }
      if (!employmentType) {
        missingParts.push("Employment type is blank");
      }
      if (!shift && !normalizedShift.placeholderSource) {
        missingParts.push("Shift is blank");
      }

      if (missingParts.length > 0) {
        const problem = `${missingParts.join(", ")}, so no salary rate can be matched.`;
        issues.push(
          makeIssue(ctx, mappedData, rowNumber, {
            severity: "warning",
            fieldKey: "basic_salary",
            cellValue:
              position && employmentType && shift
                ? `${position} · ${employmentType} · ${shift}`
                : [rawPosition || position, employmentType, shift]
                    .filter(Boolean)
                    .join(" · "),
            problem,
            howToFix:
              "They'll be imported with no basic pay until Position, Employment type and Shift are set and a rate exists in Salary Settings.",
            group_kind: "salary_rate",
            group_key: SALARY_GROUP_KEY,
          }),
        );
      } else if (position && employmentType && shift) {
      const resolved = resolveEmployeeCompensation(
        compensationPolicyConfig.salaryRates,
        compensationPolicyConfig.compensationPolicies,
        compensationPolicyConfig.allowanceTypes,
        position,
        employmentType,
        shift,
      );

      if (resolved.missing_basic) {
        issues.push(
          makeIssue(ctx, mappedData, rowNumber, {
            severity: "warning",
            fieldKey: "basic_salary",
            cellValue: `${position} · ${employmentType} · ${shift}`,
            problem: `No salary rate in Salary Settings for ${position} / ${employmentType} / ${shift}.`,
            howToFix:
              "This employee will have no basic pay until a matching rate is added in Salary Settings.",
            group_kind: "salary_rate",
            group_key: SALARY_GROUP_KEY,
          }),
        );
      }
    }
    }
  }

  return issues;
}

export function employeeStaffIdDuplicateIssue(
  ctx: BulkImportReviewFormatContext,
  mappedData: Record<string, unknown>,
  rowNumber: number,
  inFileDuplicateStaffIdGroups: Map<string, InFileDuplicateGroupInfo>,
): BulkImportReviewIssue | null {
  const staffId = String(mappedData.staff_id ?? "").trim();
  if (!staffId) {
    return null;
  }

  const group = inFileDuplicateStaffIdGroups.get(
    bulkImportNormalizedDuplicateKey(staffId),
  );
  if (!group) {
    return null;
  }

  return buildInFileDuplicateReviewIssue({
    ctx,
    mappedData,
    rowNumber,
    fieldKey: "staff_id",
    group,
    severity: "error",
  });
}
