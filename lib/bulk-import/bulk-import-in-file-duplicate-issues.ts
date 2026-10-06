import {
  bulkImportExcelRowNumber,
  bulkImportReviewRowDisplayName,
  bulkImportRowLabel,
  cellDisplayValue,
  columnHeaderForFieldKey,
  formatBulkImportReviewIssueMessage,
  type BulkImportReviewFormatContext,
  type BulkImportReviewIssue,
} from "@/lib/bulk-import/bulk-import-review-issue";
import {
  buildExpenseDuplicateKey,
  buildFixedAssetDuplicateKey,
} from "@/lib/bulk-import/expense-duplicate-key";

export function bulkImportNormalizedDuplicateKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export type InFileDuplicateGroupInfo = {
  normalizedKey: string;
  displayValue: string;
  rowNumbers: number[];
};

export function indexInFileDuplicateGroups(
  rows: Array<{ row_number: number; mapped_data: Record<string, unknown> }>,
  fieldKey: string,
): Map<string, InFileDuplicateGroupInfo> {
  const counts = new Map<
    string,
    { displayValue: string; rowNumbers: number[] }
  >();

  for (const row of rows) {
    const raw = String(row.mapped_data[fieldKey] ?? "").trim();
    if (!raw) {
      continue;
    }

    const normalizedKey = bulkImportNormalizedDuplicateKey(raw);
    const existing = counts.get(normalizedKey);
    if (existing) {
      existing.rowNumbers.push(row.row_number);
      if (!existing.displayValue) {
        existing.displayValue = raw;
      }
    } else {
      counts.set(normalizedKey, {
        displayValue: raw,
        rowNumbers: [row.row_number],
      });
    }
  }

  const groups = new Map<string, InFileDuplicateGroupInfo>();
  for (const [normalizedKey, entry] of counts.entries()) {
    if (entry.rowNumbers.length < 2) {
      continue;
    }

    groups.set(normalizedKey, {
      normalizedKey,
      displayValue: entry.displayValue,
      rowNumbers: entry.rowNumbers.slice().sort((a, b) => a - b),
    });
  }

  return groups;
}

export function inFileDuplicateGroupKey(
  fieldKey: string,
  normalizedKey: string,
): string {
  return `duplicate_in_file:${fieldKey}:${normalizedKey}`;
}

export function formatBulkImportExcelRowList(excelRowNumbers: number[]): string {
  const sorted = [...excelRowNumbers].sort((a, b) => a - b);
  if (sorted.length === 0) {
    return "rows";
  }
  if (sorted.length === 1) {
    return `row ${sorted[0]}`;
  }
  if (sorted.length === 2) {
    return `rows ${sorted[0]} and ${sorted[1]}`;
  }

  const leading = sorted.slice(0, -1).join(", ");
  const last = sorted[sorted.length - 1];
  return `rows ${leading}, and ${last}`;
}

export function inFileDuplicateHowToFix(fieldKey: string): string {
  switch (fieldKey) {
    case "product_code":
      return "Each product needs its own code.";
    case "barcode":
      return "Each product needs its own barcode.";
    case "service_name":
      return "Each service needs its own name.";
    case "staff_id":
      return "Give each employee a unique staff ID in the spreadsheet.";
    default:
      return "Each row needs a unique value in this column.";
  }
}

export function inFileDuplicateProblemText(input: {
  columnLabel: string;
  displayValue: string;
  excelRowNumbers: number[];
}): string {
  const rowsPhrase = formatBulkImportExcelRowList(input.excelRowNumbers);
  return `${input.columnLabel} "${input.displayValue}" appears more than once in this file (${rowsPhrase}).`;
}

function excelRowNumbersForGroup(
  ctx: BulkImportReviewFormatContext,
  rowNumbers: number[],
): number[] {
  const headerRowIndex = ctx.headerRowIndex ?? 0;
  return rowNumbers
    .map((rowNumber) => bulkImportExcelRowNumber(rowNumber, headerRowIndex))
    .sort((a, b) => a - b);
}

export function buildInFileDuplicateReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  fieldKey: string;
  group: InFileDuplicateGroupInfo;
  severity: BulkImportReviewIssue["severity"];
}): BulkImportReviewIssue {
  const { ctx, mappedData, rowNumber, fieldKey, group, severity } = input;
  const headerRowIndex = ctx.headerRowIndex ?? 0;
  const excel_row_number = bulkImportExcelRowNumber(rowNumber, headerRowIndex);
  const employee_name = bulkImportReviewRowDisplayName(
    ctx.importType,
    mappedData,
  );
  const row_label = bulkImportRowLabel({
    excelRowNumber: excel_row_number,
    employeeName: employee_name,
  });
  const column = columnHeaderForFieldKey(
    ctx.columnMapping,
    fieldKey,
    ctx.importType,
  );
  const excelRows = excelRowNumbersForGroup(ctx, group.rowNumbers);
  const problem = inFileDuplicateProblemText({
    columnLabel: column.label,
    displayValue: group.displayValue,
    excelRowNumbers: excelRows,
  });
  const how_to_fix = inFileDuplicateHowToFix(fieldKey);

  return {
    row_number: rowNumber,
    excel_row_number,
    employee_name,
    severity,
    column_header: column.header,
    column_label: column.label,
    cell_value: cellDisplayValue(mappedData[fieldKey]),
    problem,
    how_to_fix,
    message: formatBulkImportReviewIssueMessage({
      rowLabel: row_label,
      severity,
      problem,
      howToFix: how_to_fix,
    }),
    group_kind: "generic",
    group_key: inFileDuplicateGroupKey(fieldKey, group.normalizedKey),
  };
}

export function buildCompositeInFileDuplicateReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  groupKey: string;
  columnLabel: string;
  cellValue: string;
  problem: string;
  howToFix: string;
  severity: BulkImportReviewIssue["severity"];
}): BulkImportReviewIssue {
  const headerRowIndex = input.ctx.headerRowIndex ?? 0;
  const excel_row_number = bulkImportExcelRowNumber(
    input.rowNumber,
    headerRowIndex,
  );
  const employee_name = bulkImportReviewRowDisplayName(
    input.ctx.importType,
    input.mappedData,
  );
  const row_label = bulkImportRowLabel({
    excelRowNumber: excel_row_number,
    employeeName: employee_name,
  });

  return {
    row_number: input.rowNumber,
    excel_row_number,
    employee_name,
    severity: input.severity,
    column_header: input.columnLabel,
    column_label: input.columnLabel,
    cell_value: input.cellValue,
    problem: input.problem,
    how_to_fix: input.howToFix,
    message: formatBulkImportReviewIssueMessage({
      rowLabel: row_label,
      severity: input.severity,
      problem: input.problem,
      howToFix: input.howToFix,
    }),
    group_kind: "generic",
    group_key: input.groupKey,
  };
}

export function buildExpenseInFileDuplicateReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  inFileGroups: Map<string, number[]>;
}): BulkImportReviewIssue | null {
  const duplicateKey = buildExpenseDuplicateKey({
    date: input.mappedData.date,
    vendor: input.mappedData.vendor,
    price: input.mappedData.price,
    expense_category: input.mappedData.expense_category,
    payment_method: input.mappedData.payment_method,
  });
  if (!duplicateKey) {
    return null;
  }

  const rowNumbers = input.inFileGroups.get(duplicateKey);
  if (!rowNumbers) {
    return null;
  }

  const excelRows = excelRowNumbersForGroup(input.ctx, rowNumbers);
  const rowsPhrase = formatBulkImportExcelRowList(excelRows);
  const problem = `This expense matches another row in your file (same date, supplier, amount, category, and payment method) (${rowsPhrase}).`;
  const howToFix =
    "Remove or change the duplicate row, or confirm both expenses are intentional.";

  return buildCompositeInFileDuplicateReviewIssue({
    ctx: input.ctx,
    mappedData: input.mappedData,
    rowNumber: input.rowNumber,
    groupKey: `duplicate_in_file:expense:${duplicateKey}`,
    columnLabel: "Expense",
    cellValue: cellDisplayValue(input.mappedData.vendor),
    problem,
    howToFix,
    severity: "warning",
  });
}

export function buildExpenseExistingDuplicateReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  existingExpenseDuplicateKeys: Set<string>;
}): BulkImportReviewIssue | null {
  const duplicateKey = buildExpenseDuplicateKey({
    date: input.mappedData.date,
    vendor: input.mappedData.vendor,
    price: input.mappedData.price,
    expense_category: input.mappedData.expense_category,
    payment_method: input.mappedData.payment_method,
  });
  if (!duplicateKey || !input.existingExpenseDuplicateKeys.has(duplicateKey)) {
    return null;
  }

  const problem =
    "This expense looks like one already in the Expense Register (same date, supplier, amount, category, and payment method).";
  const howToFix =
    "Skip this row or change the details if this is a separate expense.";

  return buildCompositeInFileDuplicateReviewIssue({
    ctx: input.ctx,
    mappedData: input.mappedData,
    rowNumber: input.rowNumber,
    groupKey: "duplicate_exists:expense",
    columnLabel: "Expense",
    cellValue: cellDisplayValue(input.mappedData.vendor),
    problem,
    howToFix,
    severity: "warning",
  });
}

export function buildFixedAssetInFileDuplicateReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  inFileGroups: Map<string, number[]>;
}): BulkImportReviewIssue | null {
  const duplicateKey = buildFixedAssetDuplicateKey({
    asset_name: input.mappedData.asset_name,
    purchase_date: input.mappedData.purchase_date,
    original_cost: input.mappedData.original_cost,
  });
  if (!duplicateKey) {
    return null;
  }

  const rowNumbers = input.inFileGroups.get(duplicateKey);
  if (!rowNumbers) {
    return null;
  }

  const excelRows = excelRowNumbersForGroup(input.ctx, rowNumbers);
  const rowsPhrase = formatBulkImportExcelRowList(excelRows);
  const assetLabel = cellDisplayValue(input.mappedData.asset_name) || "Asset";
  const problem = `${assetLabel} matches another row in your file (same name, purchase date, and original cost) (${rowsPhrase}).`;
  const howToFix =
    "Remove or change the duplicate row, or confirm both assets are intentional.";

  return buildCompositeInFileDuplicateReviewIssue({
    ctx: input.ctx,
    mappedData: input.mappedData,
    rowNumber: input.rowNumber,
    groupKey: `duplicate_in_file:fixed_asset:${duplicateKey}`,
    columnLabel: "Fixed asset",
    cellValue: assetLabel,
    problem,
    howToFix,
    severity: "warning",
  });
}

export function buildFixedAssetExistingDuplicateReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  existingFixedAssetDuplicateKeys: Set<string>;
}): BulkImportReviewIssue | null {
  const duplicateKey = buildFixedAssetDuplicateKey({
    asset_name: input.mappedData.asset_name,
    purchase_date: input.mappedData.purchase_date,
    original_cost: input.mappedData.original_cost,
  });
  if (
    !duplicateKey ||
    !input.existingFixedAssetDuplicateKeys.has(duplicateKey)
  ) {
    return null;
  }

  const assetLabel = cellDisplayValue(input.mappedData.asset_name) || "Asset";
  const problem = `${assetLabel} looks like a fixed asset already in the register (same name, purchase date, and original cost).`;
  const howToFix =
    "Skip this row or change the details if this is a separate asset.";

  return buildCompositeInFileDuplicateReviewIssue({
    ctx: input.ctx,
    mappedData: input.mappedData,
    rowNumber: input.rowNumber,
    groupKey: "duplicate_exists:fixed_asset",
    columnLabel: "Fixed asset",
    cellValue: assetLabel,
    problem,
    howToFix,
    severity: "warning",
  });
}

export function buildDuplicateExistsReviewIssue(input: {
  ctx: BulkImportReviewFormatContext;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  fieldKey: string;
  existsLabel: string;
  howToFix: string;
  severity: BulkImportReviewIssue["severity"];
}): BulkImportReviewIssue {
  const { ctx, mappedData, rowNumber, fieldKey, existsLabel, howToFix, severity } =
    input;
  const headerRowIndex = ctx.headerRowIndex ?? 0;
  const excel_row_number = bulkImportExcelRowNumber(rowNumber, headerRowIndex);
  const employee_name = bulkImportReviewRowDisplayName(
    ctx.importType,
    mappedData,
  );
  const row_label = bulkImportRowLabel({
    excelRowNumber: excel_row_number,
    employeeName: employee_name,
  });
  const column = columnHeaderForFieldKey(
    ctx.columnMapping,
    fieldKey,
    ctx.importType,
  );
  const displayValue = cellDisplayValue(mappedData[fieldKey]);
  const problem = `${column.label} "${displayValue}" ${existsLabel}.`;

  return {
    row_number: rowNumber,
    excel_row_number,
    employee_name,
    severity,
    column_header: column.header,
    column_label: column.label,
    cell_value: displayValue,
    problem,
    how_to_fix: howToFix,
    message: formatBulkImportReviewIssueMessage({
      rowLabel: row_label,
      severity,
      problem,
      howToFix,
    }),
    group_kind: "generic",
    group_key: `duplicate_exists:${fieldKey}`,
  };
}
