import {

  FINISHED_PRODUCT_FIELD_DEPENDENCIES,

  FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE,

  getBulkImportTargetField,
  getBulkImportTargetFields,

} from "@/lib/bulk-import/target-fields";

import { buildMappedData } from "@/lib/bulk-import/build-mapped-data";
import {
  applyBulkImportDatesToMappedData,
  buildDateColumnProfilesForImport,
  collectExpirationBeforeManufacturingReviewIssue,
} from "@/lib/bulk-import/bulk-import-date-validation";
import { isSpreadsheetPlaceholderCell } from "@/lib/spreadsheet/spreadsheet-matrix-utils";
import { validateSupplierNameLookup } from "@/lib/bulk-import/supplier-name";
import {
  indexInFileDuplicateExpenseGroups,
  indexInFileDuplicateFixedAssetGroups,
} from "@/lib/bulk-import/expense-duplicate-key";
import {
  buildDuplicateExistsReviewIssue,
  buildExpenseExistingDuplicateReviewIssue,
  buildExpenseInFileDuplicateReviewIssue,
  buildFixedAssetExistingDuplicateReviewIssue,
  buildFixedAssetInFileDuplicateReviewIssue,
  buildInFileDuplicateReviewIssue,
  bulkImportNormalizedDuplicateKey,
  indexInFileDuplicateGroups,
} from "@/lib/bulk-import/bulk-import-in-file-duplicate-issues";
import { validateFinishedProductBarcodeForImport } from "@/lib/bulk-import/finished-product-barcode-import";
import { isCreditPaymentMethod } from "@/lib/bulk-import/payment-method-credit";
import {
  EXPENSE_REGISTER_FIXED_ASSETS_REJECTION_MESSAGE,
  isFixedAssetsExpenseCategory,
} from "@/utils/expense-register-category-guard";
import { validateExpenseSubcategoryForCategoryLookup } from "@/app/dashboard/finance/expense-register-utils";
import { validateManualExpenseRegisterPaymentStatusForWrite } from "@/utils/manual-expense-payment-status";
import {
  normalizeTenantLookupKey,
  validateTenantNameLookup,
  validateTenantNameLookupRequireMatch,
} from "@/lib/bulk-import/tenant-name-lookup";
import {
  buildReviewFormatContext,
  bulkImportExcelRowNumber,
  bulkImportReviewRowDisplayName,
  bulkImportRowLabel,
  formatBulkImportReviewIssueMessage,
  toReviewIssueRow,
  type BulkImportReviewIssue,
  type BulkImportReviewIssueRow,
} from "@/lib/bulk-import/bulk-import-review-issue";
import {
  bulkImportCodeLikeFieldKeysForType,
  bulkImportExcelCorruptedCodeMessage,
  looksLikeExcelScientificNotation,
} from "@/lib/bulk-import/bulk-import-code-column";
import { stripBulkImportColumnMappingMeta } from "@/lib/bulk-import/column-mapping-meta";
import { collectEmployeeImportReviewIssues } from "@/lib/bulk-import/employee-import-review-issues";
import {
  summarizeMissingImportPositions,
  type BulkImportMissingPositionSummary,
} from "@/lib/bulk-import/missing-positions-import";
import { reviewIssuesFromLegacyErrorMessages } from "@/lib/bulk-import/generic-import-review-issues";
import type { PayrollCompensationPolicyConfig } from "@/app/dashboard/hr-payroll/payroll-processing-utils";

function hiddenExpenseCategoryImportError(
  value: unknown,
  rows: Array<{ name: string; is_active?: boolean }>,
): string | null {
  const key = normalizeTenantLookupKey(String(value ?? ""));
  if (!key) {
    return null;
  }
  const row = rows.find(
    (entry) => normalizeTenantLookupKey(entry.name) === key,
  );
  if (row?.is_active === false) {
    return `expense_category "${String(value).trim()}" is hidden from new entries. Show it again under Administration → Finance Settings → Expense Categories, or choose another category.`;
  }
  return null;
}

function hiddenExpenseSubcategoryImportError(
  expenseCategory: unknown,
  subCategory: unknown,
  subRows: Array<{
    name: string;
    expense_category: string | null;
    is_active?: boolean;
  }>,
  categoryRows: Array<{ name: string; is_active?: boolean }>,
): string | null {
  const categoryKey = normalizeTenantLookupKey(String(expenseCategory ?? ""));
  const subKey = normalizeTenantLookupKey(String(subCategory ?? ""));
  if (!subKey) {
    return null;
  }
  if (categoryKey) {
    const categoryRow = categoryRows.find(
      (entry) => normalizeTenantLookupKey(entry.name) === categoryKey,
    );
    if (categoryRow?.is_active === false) {
      return hiddenExpenseCategoryImportError(expenseCategory, categoryRows);
    }
  }
  const row = subRows.find(
    (entry) =>
      normalizeTenantLookupKey(entry.name) === subKey &&
      normalizeTenantLookupKey(entry.expense_category ?? "") === categoryKey,
  );
  if (row?.is_active === false) {
    return `sub_category "${String(subCategory).trim()}" is hidden from new entries. Show it again under Administration → Finance Settings → Expense Categories, or choose another sub-category.`;
  }
  return null;
}

function hiddenAssetCategoryImportError(
  value: unknown,
  rows: Array<{ name: string; is_active?: boolean }>,
): string | null {
  const key = normalizeTenantLookupKey(String(value ?? ""));
  if (!key) {
    return null;
  }
  const row = rows.find(
    (entry) => normalizeTenantLookupKey(entry.name) === key,
  );
  if (row?.is_active === false) {
    return `asset_category "${String(value).trim()}" is hidden from new entries. Show it again under Administration → Asset Categories, or choose another category.`;
  }
  return null;
}
import {
  CUSTOMER_RECORD_TYPE_VALUES,
  CUSTOMER_STATUS_OPTIONS,
} from "@/app/dashboard/crm/customers/customers-utils";
import {
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  SHIFT_OPTIONS,
} from "@/app/dashboard/employees/employee-record-utils";
import { CONTRACT_STATUS_OPTIONS } from "@/app/dashboard/operations/operations-register-utils";

import type {

  BulkImportColumnMapping,

  BulkImportType,

} from "@/lib/bulk-import/types";



export type BulkImportRowValidationStatus = "valid" | "error" | "duplicate";



export type BulkImportValidatedRow = {

  id: string;

  row_number: number;

  mapped_data: Record<string, unknown>;

  status: BulkImportRowValidationStatus;

  error_message: string | null;

};



export type BulkImportValidationSummary = {

  total_rows: number;

  valid_rows: number;

  error_rows: number;

  duplicate_rows: number;

  blank_rows_skipped: number;

};



type ImportRowInput = {

  id: string;

  row_number: number;

  raw_data: Record<string, unknown>;

};

function isBlankBulkImportMappedRow(
  rawData: Record<string, unknown>,
  columnMapping: BulkImportColumnMapping,
  requiredFieldKeys: Set<string>,
): boolean {
  const mappedRequiredHeaders = Object.entries(columnMapping).filter(([, target]) =>
    requiredFieldKeys.has(target),
  );

  if (mappedRequiredHeaders.length === 0) {
    return false;
  }

  return mappedRequiredHeaders.every(([header]) =>
    isSpreadsheetPlaceholderCell(rawData[header]),
  );
}



/**

 * Column constraints sourced from live Postgres information_schema (staging DB)

 * and repo migrations:

 * - finished_products: scripts/38_sales_inventory_foundation.sql,

 *   scripts/140_finished_product_dates.sql, finished_products_sourcing_type_check

 * - service_catalog: live schema (no CREATE migration in repo)

 */

const VALID_SOURCING_TYPES = ["manufactured", "purchased"] as const;



const NUMERIC_FIELD_CONSTRAINTS = {

  current_stock: { precision: 18, scale: 4 },

  unit_cost: { precision: 18, scale: 4 },

  standard_selling_price: { precision: 18, scale: 4 },

  default_rate: { precision: 12, scale: 2 },

  basic_salary: { precision: 12, scale: 2 },

} as const;



const NON_NEGATIVE_NUMERIC_FIELDS = new Set([

  "current_stock",

  "unit_cost",

  "standard_selling_price",

  "default_rate",

]);



const FIXED_ASSET_ORIGINAL_COST_CONSTRAINT = { precision: 12, scale: 2 } as const;

const EXPENSE_AUTO_POST_CATEGORY_PATTERNS = [
  "staff salaries",
  "employer ssnit",
  "statutory remittance",
] as const;

const CUSTOMER_TYPE_VALUES = [...CUSTOMER_RECORD_TYPE_VALUES];
const CUSTOMER_STATUS_VALUES = CUSTOMER_STATUS_OPTIONS.map(
  (option) => option.value,
);

export type EmployeeImportLookupContext = {
  departmentNameMatchCounts: Map<string, number>;
  positionTitleMatchCounts: Map<string, number>;
  positionTitleByLookupKey: Map<string, string>;
  contractProjectNameMatchCounts: Map<string, number>;
  supervisorNameMatchCounts: Map<string, number>;
  assignedSiteNameMatchCounts: Map<string, number>;
  existingStaffIds: Set<string>;
};

export type CustomerImportLookupContext = {
  supervisorNameMatchCounts: Map<string, number>;
};

export type ExpenseImportLookupContext = {
  expenseCategoryMatchCounts: Map<string, number>;
  expenseSubcategoryMatchCounts: Map<string, number>;
  expenseSubcategoryKeysByCategory: Map<string, Set<string>>;
  expenseCategoryRows: Array<{ name: string; is_active?: boolean }>;
  expenseSubcategoryRows: Array<{
    name: string;
    expense_category: string | null;
    is_active?: boolean;
  }>;
  paymentMethodMatchCounts: Map<string, number>;
  approverNameMatchCounts: Map<string, number>;
  existingExpenseDuplicateKeys: Set<string>;
};

export type FixedAssetImportLookupContext = {
  assetCategoryMatchCounts: Map<string, number>;
  assetCategoryRows: Array<{ name: string; is_active?: boolean }>;
  depreciationMethodMatchCounts: Map<string, number>;
  paymentMethodMatchCounts: Map<string, number>;
  existingFixedAssetDuplicateKeys: Set<string>;
};

type BulkImportValidationLookups = {
  supplierNameMatchCounts: Map<string, number>;
  employeeLookups: EmployeeImportLookupContext | null;
  customerLookups: CustomerImportLookupContext | null;
  expenseLookups: ExpenseImportLookupContext | null;
  fixedAssetLookups: FixedAssetImportLookupContext | null;
};



function isBlank(value: unknown): boolean {

  if (value === null || value === undefined) {

    return true;

  }



  return String(value).trim() === "";

}



function normalizedKey(value: unknown): string {

  return String(value ?? "").trim().toLowerCase();

}



let bulkImportFieldLabelImportType: BulkImportType | null = null;

function fieldLabel(fieldKey: string): string {
  if (bulkImportFieldLabelImportType) {
    const field = getBulkImportTargetField(
      bulkImportFieldLabelImportType,
      fieldKey,
    );
    if (field?.label) {
      return field.label;
    }
  }

  return fieldKey
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}



function parseNumericToken(value: unknown): string | null | "invalid" {

  if (isBlank(value)) {

    return null;

  }



  const trimmed = String(value).trim().replace(/,/g, "");

  if (trimmed === "" || trimmed === "-" || trimmed === "+") {

    return "invalid";

  }



  if (/[eE]/.test(trimmed)) {

    return "invalid";

  }



  if (!/^[-+]?\d+(\.\d+)?$/.test(trimmed)) {

    return "invalid";

  }



  return trimmed;

}



function validateNumericField(

  fieldKey: keyof typeof NUMERIC_FIELD_CONSTRAINTS,

  value: unknown,

): string | null {

  const token = parseNumericToken(value);

  if (token === null) {

    return null;

  }



  if (token === "invalid") {

    return `${fieldLabel(fieldKey)} must be a valid number`;

  }



  const { precision, scale } = NUMERIC_FIELD_CONSTRAINTS[fieldKey];
  const unsigned = token.replace(/^[-+]/, "");
  const [integerPart, fractionalPart = ""] = unsigned.split(".");

  if (fractionalPart.length > scale) {
    return `${fieldLabel(fieldKey)} must have at most ${scale} decimal places`;
  }



  const integerDigits = integerPart.replace(/^0+/, "");

  const maxIntegerDigits = precision - scale;

  if (integerDigits.length > maxIntegerDigits) {

    return `${fieldLabel(fieldKey)} is too large (maximum ${maxIntegerDigits} digits before the decimal)`;

  }



  const numericValue = Number(token);

  if (!Number.isFinite(numericValue)) {

    return `${fieldLabel(fieldKey)} must be a valid number`;

  }



  if (NON_NEGATIVE_NUMERIC_FIELDS.has(fieldKey) && numericValue < 0) {

    return `${fieldLabel(fieldKey)} cannot be negative`;

  }



  return null;

}



function validateEnumField(
  fieldKey: string,
  value: unknown,
  allowed: readonly string[],
): string | null {
  if (isBlank(value)) {
    return null;
  }

  const trimmed = String(value).trim();
  const match = allowed.find(
    (option) => option.toLowerCase() === trimmed.toLowerCase(),
  );
  if (!match) {
    return `${fieldLabel(fieldKey)} must be one of: ${allowed.join(", ")}`;
  }

  return null;
}



function validatePositiveNumericField(
  fieldKey: string,
  value: unknown,
  options: { required?: boolean; allowZero?: boolean } = {},
): string | null {
  const token = parseNumericToken(value);

  if (token === null) {
    return options.required ? `${fieldLabel(fieldKey)} is required` : null;
  }

  if (token === "invalid") {
    return `${fieldLabel(fieldKey)} must be a valid number`;
  }

  const parsed = Number(token);
  if (!Number.isFinite(parsed)) {
    return `${fieldLabel(fieldKey)} must be a valid number`;
  }

  if (options.allowZero ? parsed < 0 : parsed <= 0) {
    return `${fieldLabel(fieldKey)} must be a positive number`;
  }

  return null;
}

function validatePrecisionScaleNumericField(
  fieldKey: string,
  value: unknown,
  constraint: { precision: number; scale: number },
  options: { required?: boolean; mustBePositive?: boolean } = {},
): string | null {
  const token = parseNumericToken(value);

  if (token === null) {
    return options.required ? `${fieldLabel(fieldKey)} is required` : null;
  }

  if (token === "invalid") {
    return `${fieldLabel(fieldKey)} must be a valid number`;
  }

  const unsigned = token.replace(/^[-+]/, "");
  const [integerPart, fractionalPart = ""] = unsigned.split(".");

  if (fractionalPart.length > constraint.scale) {
    return `${fieldLabel(fieldKey)} must have at most ${constraint.scale} decimal places`;
  }

  const integerDigits = integerPart.replace(/^0+/, "");
  const maxIntegerDigits = constraint.precision - constraint.scale;
  if (integerDigits.length > maxIntegerDigits) {
    return `${fieldLabel(fieldKey)} is too large (maximum ${maxIntegerDigits} digits before the decimal)`;
  }

  const parsed = Number(token);
  if (!Number.isFinite(parsed)) {
    return `${fieldLabel(fieldKey)} must be a valid number`;
  }

  if (options.mustBePositive && parsed <= 0) {
    return `${fieldLabel(fieldKey)} must be a positive number`;
  }

  return null;
}



function validatePercentageField(
  fieldKey: string,
  value: unknown,
): string | null {
  const token = parseNumericToken(value);
  if (token === null) {
    return null;
  }

  if (token === "invalid") {
    return `${fieldLabel(fieldKey)} must be a valid number`;
  }

  const parsed = Number(token);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return `${fieldLabel(fieldKey)} must be between 0 and 100`;
  }

  return null;
}



function validateNonNegativeNumericField(
  fieldKey: string,
  value: unknown,
): string | null {
  const token = parseNumericToken(value);
  if (token === null) {
    return null;
  }

  if (token === "invalid") {
    return `${fieldLabel(fieldKey)} must be a valid number`;
  }

  const parsed = Number(token);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return `${fieldLabel(fieldKey)} must be zero or greater`;
  }

  return null;
}



function isSpecialExpenseCategory(value: unknown): boolean {
  const normalized = normalizeTenantLookupKey(value);
  if (!normalized) {
    return false;
  }

  return EXPENSE_AUTO_POST_CATEGORY_PATTERNS.some(
    (pattern) => normalized === pattern || normalized.includes(pattern),
  );
}



function collectExpenseWarnings(
  mappedData: Record<string, unknown>,
): string[] {
  const warnings: string[] = [];

  if (
    isSpecialExpenseCategory(mappedData.expense_category) ||
    isSpecialExpenseCategory(mappedData.sub_category)
  ) {
    warnings.push(
      "This category normally auto-posts from payroll or other modules; bulk-importing it directly may cause double-counting.",
    );
  }

  return warnings;
}



function collectFieldErrors(
  importType: BulkImportType,
  mappedData: Record<string, unknown>,
  lookups: BulkImportValidationLookups,
): string[] {

  const errors: string[] = [];
  bulkImportFieldLabelImportType = importType;

  const targetFields = getBulkImportTargetFields(importType);

  for (const fieldKey of bulkImportCodeLikeFieldKeysForType(importType)) {
    if (!(fieldKey in mappedData) || isBlank(mappedData[fieldKey])) {
      continue;
    }
    const raw = mappedData[fieldKey];
    if (looksLikeExcelScientificNotation(raw)) {
      const label = fieldLabel(fieldKey);
      const { problem, howToFix } = bulkImportExcelCorruptedCodeMessage(
        label,
        String(raw ?? "").trim(),
      );
      errors.push(`${problem} ${howToFix}`);
    }
  }

  for (const field of targetFields) {

    if (field.required && isBlank(mappedData[field.key])) {

      errors.push(`${fieldLabel(field.key)} is required`);

    }

  }



  if (importType === "product") {

    for (const fieldKey of Object.keys(NUMERIC_FIELD_CONSTRAINTS)) {

      if (!(fieldKey in mappedData)) {

        continue;

      }



      const numericError = validateNumericField(

        fieldKey as keyof typeof NUMERIC_FIELD_CONSTRAINTS,

        mappedData[fieldKey],

      );

      if (numericError) {

        errors.push(numericError);

      }

    }



    if ("supplier_name" in mappedData) {
      const supplierError = validateSupplierNameLookup(
        mappedData.supplier_name,
        lookups.supplierNameMatchCounts,
      );
      if (supplierError) {
        errors.push(supplierError);
      }
    }

    if ("barcode" in mappedData) {
      const barcodeError = validateFinishedProductBarcodeForImport(
        mappedData.barcode,
        fieldLabel("barcode"),
      );
      if (barcodeError) {
        errors.push(barcodeError);
      }
    }

    const sourcingRaw = mappedData.sourcing_type;

    if (!isBlank(sourcingRaw)) {

      const sourcingType = normalizedKey(sourcingRaw);

      if (!VALID_SOURCING_TYPES.includes(sourcingType as (typeof VALID_SOURCING_TYPES)[number])) {

        errors.push(

          `sourcing_type must be one of: ${VALID_SOURCING_TYPES.join(", ")}`,

        );

      }

    }



    const resolvedSourcingType = isBlank(sourcingRaw)

      ? ""

      : normalizedKey(sourcingRaw);



    for (const dependency of FINISHED_PRODUCT_FIELD_DEPENDENCIES) {

      if (

        dependency.requiredWhen.equals === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE &&

        resolvedSourcingType === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE &&

        isBlank(mappedData[dependency.field])

      ) {

        errors.push(
          "supplier_name is required when sourcing type is purchased",
        );

      }

    }



  }



  if (importType === "service") {

    if ("default_rate" in mappedData) {

      const numericError = validateNumericField(

        "default_rate",

        mappedData.default_rate,

      );

      if (numericError) {

        errors.push(numericError);

      }

    }

  }



  if (importType === "employee") {
    return errors;
  }

  if (importType === "customer") {
    const customerLookups = lookups.customerLookups;
    if (!customerLookups) {
      throw new Error("Customer import validation requires lookup context.");
    }

    const enumChecks: Array<[string, readonly string[]]> = [
      ["contract_status", CONTRACT_STATUS_OPTIONS],
      ["customer_type", CUSTOMER_TYPE_VALUES],
      ["status", CUSTOMER_STATUS_VALUES],
    ];

    for (const [fieldKey, allowedValues] of enumChecks) {
      if (!(fieldKey in mappedData)) {
        continue;
      }

      if (
        fieldKey === "customer_type" &&
        !isBlank(mappedData.customer_type) &&
        String(mappedData.customer_type).trim().toLowerCase() === "both"
      ) {
        errors.push(
          `${fieldLabel(fieldKey)} value "both" is no longer valid; use service_client, digital_subscriber, or product_client`,
        );
        continue;
      }

      if (
        fieldKey === "customer_type" &&
        !isBlank(mappedData.customer_type) &&
        String(mappedData.customer_type).trim().toLowerCase() === "all"
      ) {
        errors.push(
          `${fieldLabel(fieldKey)} value "all" is for filtering only; use service_client, digital_subscriber, or product_client`,
        );
        continue;
      }

      const enumError = validateEnumField(
        fieldKey,
        mappedData[fieldKey],
        allowedValues,
      );
      if (enumError) {
        errors.push(enumError);
      }
    }

    if ("supervisor_name" in mappedData) {
      const lookupError = validateTenantNameLookup(
        mappedData.supervisor_name,
        customerLookups.supervisorNameMatchCounts,
        "supervisor_name",
        "employees",
      );
      if (lookupError) {
        errors.push(lookupError);
      }
    }
  }

  if (importType === "expense") {
    const expenseLookups = lookups.expenseLookups;
    if (!expenseLookups) {
      throw new Error("Expense import validation requires lookup context.");
    }

    const priceError = validatePositiveNumericField("price", mappedData.price, {
      required: true,
    });
    if (priceError) {
      errors.push(priceError);
    }

    if ("quantity" in mappedData) {
      const quantityError = validatePositiveNumericField(
        "quantity",
        mappedData.quantity,
      );
      if (quantityError) {
        errors.push(quantityError);
      }
    }

    if ("wht_rate" in mappedData) {
      const whtRateError = validatePercentageField(
        "wht_rate",
        mappedData.wht_rate,
      );
      if (whtRateError) {
        errors.push(whtRateError);
      }
    }

    if ("input_vat_amount" in mappedData) {
      const inputVatError = validateNonNegativeNumericField(
        "input_vat_amount",
        mappedData.input_vat_amount,
      );
      if (inputVatError) {
        errors.push(inputVatError);
      }
    }

    if ("payment_status" in mappedData) {
      const rawStatus = mappedData.payment_status;
      if (rawStatus != null && String(rawStatus).trim() !== "") {
        const manualPaymentError = validateManualExpenseRegisterPaymentStatusForWrite(
          String(rawStatus),
        );
        if (manualPaymentError) {
          errors.push(`${fieldLabel("payment_status")}: ${manualPaymentError}`);
        }
      }
    }

    const categoryLookups: Array<[string, Map<string, number>, string]> = [
      [
        "expense_category",
        expenseLookups.expenseCategoryMatchCounts,
        "expense categories",
      ],
      ["approved_by", expenseLookups.approverNameMatchCounts, "approvers"],
    ];

    for (const [fieldKey, matchCounts, entityLabel] of categoryLookups) {
      if (!(fieldKey in mappedData)) {
        continue;
      }

      if (fieldKey === "expense_category") {
        const hiddenError = hiddenExpenseCategoryImportError(
          mappedData[fieldKey],
          expenseLookups.expenseCategoryRows,
        );
        if (hiddenError) {
          errors.push(hiddenError);
          continue;
        }
      }

      const lookupError = validateTenantNameLookup(
        mappedData[fieldKey],
        matchCounts,
        fieldKey,
        entityLabel,
      );
      if (lookupError) {
        errors.push(lookupError);
      }
    }

    if ("sub_category" in mappedData) {
      const hiddenSubError = hiddenExpenseSubcategoryImportError(
        mappedData.expense_category,
        mappedData.sub_category,
        expenseLookups.expenseSubcategoryRows,
        expenseLookups.expenseCategoryRows,
      );
      if (hiddenSubError) {
        errors.push(hiddenSubError);
      }
      const subLookupError = validateTenantNameLookup(
        mappedData.sub_category,
        expenseLookups.expenseSubcategoryMatchCounts,
        "sub_category",
        "expense subcategories",
      );
      if (subLookupError) {
        errors.push(subLookupError);
      }

      const pairError = validateExpenseSubcategoryForCategoryLookup(
        mappedData.expense_category,
        mappedData.sub_category,
        expenseLookups.expenseSubcategoryKeysByCategory,
      );
      if (pairError) {
        errors.push(pairError);
      }
    }

    if ("payment_method" in mappedData) {
      const paymentMethodError = validateTenantNameLookupRequireMatch(
        mappedData.payment_method,
        expenseLookups.paymentMethodMatchCounts,
        "payment_method",
        "payment methods",
      );
      if (paymentMethodError) {
        errors.push(paymentMethodError);
      }
    }
  }

  if (importType === "fixed_asset") {
    const fixedAssetLookups = lookups.fixedAssetLookups;
    if (!fixedAssetLookups) {
      throw new Error("Fixed asset import validation requires lookup context.");
    }

    const originalCostError = validatePrecisionScaleNumericField(
      "original_cost",
      mappedData.original_cost,
      FIXED_ASSET_ORIGINAL_COST_CONSTRAINT,
      { required: true, mustBePositive: true },
    );
    if (originalCostError) {
      errors.push(originalCostError);
    }

    if ("quantity" in mappedData) {
      const quantityError = validatePositiveNumericField(
        "quantity",
        mappedData.quantity,
      );
      if (quantityError) {
        errors.push(quantityError);
      }
    }

    if ("useful_life_years" in mappedData) {
      const usefulLifeError = validatePositiveNumericField(
        "useful_life_years",
        mappedData.useful_life_years,
      );
      if (usefulLifeError) {
        errors.push(usefulLifeError);
      }
    }

    const categoryLookups: Array<[string, Map<string, number>, string]> = [
      [
        "asset_category",
        fixedAssetLookups.assetCategoryMatchCounts,
        "asset categories",
      ],
      [
        "depreciation_method",
        fixedAssetLookups.depreciationMethodMatchCounts,
        "depreciation methods",
      ],
    ];

    for (const [fieldKey, matchCounts, entityLabel] of categoryLookups) {
      if (!(fieldKey in mappedData)) {
        continue;
      }

      if (fieldKey === "asset_category") {
        const hiddenError = hiddenAssetCategoryImportError(
          mappedData[fieldKey],
          fixedAssetLookups.assetCategoryRows,
        );
        if (hiddenError) {
          errors.push(hiddenError);
          continue;
        }
      }

      const lookupError = validateTenantNameLookup(
        mappedData[fieldKey],
        matchCounts,
        fieldKey,
        entityLabel,
      );
      if (lookupError) {
        errors.push(lookupError);
      }
    }

    if ("payment_method" in mappedData) {
      const paymentMethodError = validateTenantNameLookupRequireMatch(
        mappedData.payment_method,
        fixedAssetLookups.paymentMethodMatchCounts,
        "payment_method",
        "payment methods",
      );
      if (paymentMethodError) {
        errors.push(paymentMethodError);
      }
    }

    if (
      isCreditPaymentMethod(String(mappedData.payment_method ?? "")) &&
      isBlank(mappedData.vendor_name)
    ) {
      errors.push(
        "Supplier name is required when payment method is credit / on account",
      );
    }
  }

  bulkImportFieldLabelImportType = null;

  return errors;

}



function collectServiceDuplicateReviewIssues(input: {
  ctx: ReturnType<typeof buildReviewFormatContext>;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  inFileDuplicateServiceGroups: ReturnType<typeof indexInFileDuplicateGroups>;
  existingServiceNames: Set<string>;
}): BulkImportReviewIssue[] {
  const serviceName = String(input.mappedData.service_name ?? "").trim();
  if (!serviceName) {
    return [];
  }

  const key = bulkImportNormalizedDuplicateKey(serviceName);
  const issues: BulkImportReviewIssue[] = [];
  const inFileGroup = input.inFileDuplicateServiceGroups.get(key);
  if (inFileGroup) {
    issues.push(
      buildInFileDuplicateReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        fieldKey: "service_name",
        group: inFileGroup,
        severity: "warning",
      }),
    );
  }

  if (input.existingServiceNames.has(key)) {
    issues.push(
      buildDuplicateExistsReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        fieldKey: "service_name",
        existsLabel: "is already in your service catalog",
        howToFix: "Use a different service name or skip this row.",
        severity: "warning",
      }),
    );
  }

  return issues;
}

function collectProductDuplicateReviewIssues(input: {
  ctx: ReturnType<typeof buildReviewFormatContext>;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  inFileDuplicateProductGroups: ReturnType<typeof indexInFileDuplicateGroups>;
  existingProductCodes: Set<string>;
}): BulkImportReviewIssue[] {
  const productCode = String(input.mappedData.product_code ?? "").trim();
  if (!productCode) {
    return [];
  }

  const key = bulkImportNormalizedDuplicateKey(productCode);
  const issues: BulkImportReviewIssue[] = [];
  const inFileGroup = input.inFileDuplicateProductGroups.get(key);
  if (inFileGroup) {
    issues.push(
      buildInFileDuplicateReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        fieldKey: "product_code",
        group: inFileGroup,
        severity: "error",
      }),
    );
  }

  if (input.existingProductCodes.has(key)) {
    issues.push(
      buildDuplicateExistsReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        fieldKey: "product_code",
        existsLabel: "is already in Inventory",
        howToFix: "Use a different product code or remove this row.",
        severity: "error",
      }),
    );
  }

  return issues;
}

function collectProductBarcodeDuplicateReviewIssues(input: {
  ctx: ReturnType<typeof buildReviewFormatContext>;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  inFileDuplicateBarcodeGroups: ReturnType<typeof indexInFileDuplicateGroups>;
  existingProductBarcodes: Set<string>;
}): BulkImportReviewIssue[] {
  const barcode = String(input.mappedData.barcode ?? "").trim();
  if (!barcode) {
    return [];
  }

  const key = bulkImportNormalizedDuplicateKey(barcode);
  const issues: BulkImportReviewIssue[] = [];
  const inFileGroup = input.inFileDuplicateBarcodeGroups.get(key);
  if (inFileGroup) {
    issues.push(
      buildInFileDuplicateReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        fieldKey: "barcode",
        group: inFileGroup,
        severity: "error",
      }),
    );
  }

  if (input.existingProductBarcodes.has(key)) {
    issues.push(
      buildDuplicateExistsReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        fieldKey: "barcode",
        existsLabel: "is already assigned to another product in Inventory",
        howToFix: "Use a different barcode or leave the column blank to auto-generate one.",
        severity: "error",
      }),
    );
  }

  return issues;
}

function collectDuplicateAndWarningReviewIssues(input: {
  importType: BulkImportType;
  ctx: ReturnType<typeof buildReviewFormatContext>;
  mappedData: Record<string, unknown>;
  rowNumber: number;
  inFileDuplicateProductGroups: ReturnType<typeof indexInFileDuplicateGroups>;
  inFileDuplicateProductBarcodeGroups: ReturnType<typeof indexInFileDuplicateGroups>;
  existingProductCodes: Set<string>;
  existingProductBarcodes: Set<string>;
  inFileDuplicateServiceGroups: ReturnType<typeof indexInFileDuplicateGroups>;
  existingServiceNames: Set<string>;
  inFileDuplicateExpenseGroups: Map<string, number[]>;
  existingExpenseDuplicateKeys: Set<string>;
  inFileDuplicateFixedAssetGroups: Map<string, number[]>;
  existingFixedAssetDuplicateKeys: Set<string>;
}): BulkImportReviewIssue[] {
  if (input.importType === "product") {
    return [
      ...collectProductDuplicateReviewIssues({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        inFileDuplicateProductGroups: input.inFileDuplicateProductGroups,
        existingProductCodes: input.existingProductCodes,
      }),
      ...collectProductBarcodeDuplicateReviewIssues({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        inFileDuplicateBarcodeGroups: input.inFileDuplicateProductBarcodeGroups,
        existingProductBarcodes: input.existingProductBarcodes,
      }),
    ];
  }

  if (input.importType === "service") {
    return collectServiceDuplicateReviewIssues({
      ctx: input.ctx,
      mappedData: input.mappedData,
      rowNumber: input.rowNumber,
      inFileDuplicateServiceGroups: input.inFileDuplicateServiceGroups,
      existingServiceNames: input.existingServiceNames,
    });
  }

  if (input.importType === "expense") {
    return [
      buildExpenseInFileDuplicateReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        inFileGroups: input.inFileDuplicateExpenseGroups,
      }),
      buildExpenseExistingDuplicateReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        existingExpenseDuplicateKeys: input.existingExpenseDuplicateKeys,
      }),
    ].filter((issue): issue is BulkImportReviewIssue => issue !== null);
  }

  if (input.importType === "fixed_asset") {
    return [
      buildFixedAssetInFileDuplicateReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        inFileGroups: input.inFileDuplicateFixedAssetGroups,
      }),
      buildFixedAssetExistingDuplicateReviewIssue({
        ctx: input.ctx,
        mappedData: input.mappedData,
        rowNumber: input.rowNumber,
        existingFixedAssetDuplicateKeys: input.existingFixedAssetDuplicateKeys,
      }),
    ].filter((issue): issue is BulkImportReviewIssue => issue !== null);
  }

  return [];
}

function collectProductOpeningStockCostWarning(input: {
  ctx: ReturnType<typeof buildReviewFormatContext>;
  mappedData: Record<string, unknown>;
  rowNumber: number;
}): BulkImportReviewIssue | null {
  if (!("current_stock" in input.mappedData) || isBlank(input.mappedData.current_stock)) {
    return null;
  }

  const stockError = validateNumericField(
    "current_stock",
    input.mappedData.current_stock,
  );
  if (stockError) {
    return null;
  }

  const stockToken = parseNumericToken(input.mappedData.current_stock);
  const stock =
    stockToken && stockToken !== "invalid" ? Number(stockToken) : 0;
  if (!Number.isFinite(stock) || stock <= 0) {
    return null;
  }

  if ("unit_cost" in input.mappedData && !isBlank(input.mappedData.unit_cost)) {
    return null;
  }

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
  const problem =
    "Opening stock will be recorded with zero cost — add a Unit cost to value your inventory correctly.";
  const how_to_fix =
    "Enter a unit cost in your spreadsheet and upload the file again, or leave Current stock blank if you are not opening stock yet.";

  return {
    row_number: input.rowNumber,
    excel_row_number,
    employee_name,
    severity: "warning",
    column_header: "Current stock",
    column_label: "Current stock",
    cell_value: String(input.mappedData.current_stock ?? "").trim(),
    problem,
    how_to_fix,
    message: formatBulkImportReviewIssueMessage({
      rowLabel: row_label,
      severity: "warning",
      problem,
      howToFix: how_to_fix,
    }),
    group_kind: "generic",
    group_key: "opening_stock_zero_cost",
  };
}

export function validateImportRows(input: {
  importType: BulkImportType;
  columnMapping: BulkImportColumnMapping;
  rows: ImportRowInput[];
  existingProductCodes?: Set<string>;
  existingProductBarcodes?: Set<string>;
  existingServiceNames?: Set<string>;
  supplierNameMatchCounts?: Map<string, number>;
  employeeLookups?: EmployeeImportLookupContext;
  employeeCompensationPolicyConfig?: PayrollCompensationPolicyConfig | null;
  customerLookups?: CustomerImportLookupContext;
  expenseLookups?: ExpenseImportLookupContext;
  fixedAssetLookups?: FixedAssetImportLookupContext;
}): {

  validatedRows: BulkImportValidatedRow[];

  summary: BulkImportValidationSummary;

  issueRows: BulkImportReviewIssueRow[];

  warningRows: BulkImportReviewIssueRow[];

  missingPositions: BulkImportMissingPositionSummary[];

} {

  const columnMappingForData = stripBulkImportColumnMappingMeta(
    input.columnMapping,
  );
  const reviewCtx = buildReviewFormatContext({
    importType: input.importType,
    columnMapping: input.columnMapping,
  });
  const allReviewIssues: BulkImportReviewIssue[] = [];

  const existingProductCodes =

    input.existingProductCodes ?? new Set<string>();

  const existingProductBarcodes =
    input.existingProductBarcodes ?? new Set<string>();

  const existingServiceNames =
    input.existingServiceNames ?? new Set<string>();
  const supplierNameMatchCounts =
    input.supplierNameMatchCounts ?? new Map<string, number>();
  const employeeLookups =
    input.importType === "employee" ? (input.employeeLookups ?? null) : null;
  const customerLookups =
    input.importType === "customer" ? (input.customerLookups ?? null) : null;
  const expenseLookups =
    input.importType === "expense" ? (input.expenseLookups ?? null) : null;
  const fixedAssetLookups =
    input.importType === "fixed_asset" ? (input.fixedAssetLookups ?? null) : null;
  const validationLookups: BulkImportValidationLookups = {
    supplierNameMatchCounts,
    employeeLookups,
    customerLookups,
    expenseLookups,
    fixedAssetLookups,
  };

  const requiredFieldKeys = new Set(
    getBulkImportTargetFields(input.importType)
      .filter((field) => field.required)
      .map((field) => field.key),
  );

  let blankRowsSkipped = 0;
  const rowsForValidation: ImportRowInput[] = [];

  for (const row of input.rows) {
    if (
      isBlankBulkImportMappedRow(
        row.raw_data,
        columnMappingForData,
        requiredFieldKeys,
      )
    ) {
      blankRowsSkipped += 1;
      continue;
    }

    rowsForValidation.push(row);
  }

  const stagedRows = rowsForValidation.map((row) => ({

    id: row.id,

    row_number: row.row_number,

    mapped_data: buildMappedData(row.raw_data, input.columnMapping),

  }));

  const dateColumnProfiles = buildDateColumnProfilesForImport(
    input.importType,
    stagedRows.map((row) => row.mapped_data),
  );

  const stagedRowsWithDates = stagedRows.map((row) => {
    const dateApply = applyBulkImportDatesToMappedData({
      importType: input.importType,
      mappedData: row.mapped_data,
      rowNumber: row.row_number,
      ctx: reviewCtx,
      profiles: dateColumnProfiles,
      requiredFieldKeys,
    });
    return {
      ...row,
      mapped_data: dateApply.mappedData,
      dateReviewIssues: dateApply.issues,
      dateLegacyErrors: dateApply.legacyErrors,
    };
  });



  const inFileDuplicateProductGroups =
    input.importType === "product"
      ? indexInFileDuplicateGroups(stagedRowsWithDates, "product_code")
      : new Map();

  const inFileDuplicateProductBarcodeGroups =
    input.importType === "product"
      ? indexInFileDuplicateGroups(stagedRowsWithDates, "barcode")
      : new Map();

  const inFileDuplicateServiceGroups =
    input.importType === "service"
      ? indexInFileDuplicateGroups(stagedRowsWithDates, "service_name")
      : new Map();

  const inFileDuplicateStaffIdGroups =
    input.importType === "employee"
      ? indexInFileDuplicateGroups(stagedRowsWithDates, "staff_id")
      : new Map();

  const inFileDuplicateExpenseGroups =
    input.importType === "expense"
      ? indexInFileDuplicateExpenseGroups(stagedRowsWithDates)
      : new Map<string, number[]>();

  const existingExpenseDuplicateKeys =
    input.importType === "expense"
      ? (expenseLookups?.existingExpenseDuplicateKeys ?? new Set<string>())
      : new Set<string>();

  const inFileDuplicateFixedAssetGroups =
    input.importType === "fixed_asset"
      ? indexInFileDuplicateFixedAssetGroups(stagedRowsWithDates)
      : new Map<string, number[]>();

  const existingFixedAssetDuplicateKeys =
    input.importType === "fixed_asset"
      ? (fixedAssetLookups?.existingFixedAssetDuplicateKeys ?? new Set<string>())
      : new Set<string>();



  const validatedRows: BulkImportValidatedRow[] = stagedRowsWithDates.map((row) => {
    const pushIssues = (...issues: BulkImportReviewIssue[]) => {
      allReviewIssues.push(...issues);
    };

    pushIssues(...row.dateReviewIssues);

    const expirationOrderIssue = collectExpirationBeforeManufacturingReviewIssue(
      {
        ctx: reviewCtx,
        mappedData: row.mapped_data,
        rowNumber: row.row_number,
        dateReviewIssues: row.dateReviewIssues,
        dateLegacyErrors: row.dateLegacyErrors,
      },
    );
    if (expirationOrderIssue) {
      pushIssues(expirationOrderIssue);
    }

    if (input.importType === "employee") {
      if (!employeeLookups) {
        throw new Error("Employee import validation requires lookup context.");
      }

      const rowIssues = collectEmployeeImportReviewIssues({
        mappedData: row.mapped_data,
        rowNumber: row.row_number,
        ctx: reviewCtx,
        employeeLookups,
        compensationPolicyConfig: input.employeeCompensationPolicyConfig,
        inFileDuplicateStaffIdGroups,
      });
      pushIssues(...rowIssues);

      const errors = rowIssues.filter((issue) => issue.severity === "error");
      if (row.dateLegacyErrors.length > 0 || errors.length > 0) {
        const dateErrorIssues =
          row.dateLegacyErrors.length > 0
            ? reviewIssuesFromLegacyErrorMessages({
                ctx: reviewCtx,
                mappedData: row.mapped_data,
                rowNumber: row.row_number,
                messages: row.dateLegacyErrors,
                severity: "error",
              })
            : [];
        pushIssues(...dateErrorIssues);
        const combined = [...dateErrorIssues, ...errors];
        return {
          id: row.id,
          row_number: row.row_number,
          mapped_data: row.mapped_data,
          status: "error",
          error_message: combined.map((issue) => issue.message).join("\n"),
        };
      }

      const warnings = rowIssues.filter((issue) => issue.severity === "warning");
      return {
        id: row.id,
        row_number: row.row_number,
        mapped_data: row.mapped_data,
        status: "valid",
        error_message:
          warnings.length > 0
            ? warnings.map((issue) => issue.message).join("\n")
            : null,
      };
    }

    const duplicateAndWarningIssues = collectDuplicateAndWarningReviewIssues({
      importType: input.importType,
      ctx: reviewCtx,
      mappedData: row.mapped_data,
      rowNumber: row.row_number,
      inFileDuplicateProductGroups,
      inFileDuplicateProductBarcodeGroups,
      existingProductCodes,
      existingProductBarcodes,
      inFileDuplicateServiceGroups,
      existingServiceNames,
      inFileDuplicateExpenseGroups,
      existingExpenseDuplicateKeys,
      inFileDuplicateFixedAssetGroups,
      existingFixedAssetDuplicateKeys,
    });

    const hardErrors = collectFieldErrors(
      input.importType,
      row.mapped_data,
      validationLookups,
    );

    const blockingDuplicateIssues = duplicateAndWarningIssues.filter(
      (issue) => issue.severity === "error",
    );

    if (
      row.dateLegacyErrors.length > 0 ||
      hardErrors.length > 0 ||
      expirationOrderIssue
    ) {
      const rowIssues = reviewIssuesFromLegacyErrorMessages({
        ctx: reviewCtx,
        mappedData: row.mapped_data,
        rowNumber: row.row_number,
        messages: [...row.dateLegacyErrors, ...hardErrors],
        severity: "error",
      });
      pushIssues(...rowIssues);
      if (duplicateAndWarningIssues.length > 0) {
        pushIssues(...duplicateAndWarningIssues);
      }

      const combinedMessages = [
        ...(expirationOrderIssue ? [expirationOrderIssue] : []),
        ...rowIssues,
        ...duplicateAndWarningIssues,
      ].map((issue) => issue.message);

      return {
        id: row.id,
        row_number: row.row_number,
        mapped_data: row.mapped_data,
        status: "error",
        error_message: combinedMessages.join("\n"),
      };
    }

    if (input.importType === "product" && blockingDuplicateIssues.length > 0) {
      pushIssues(...duplicateAndWarningIssues);

      return {
        id: row.id,
        row_number: row.row_number,
        mapped_data: row.mapped_data,
        status: "duplicate",
        error_message: duplicateAndWarningIssues
          .map((issue) => issue.message)
          .join("\n"),
      };
    }

    if (input.importType === "service" && duplicateAndWarningIssues.length > 0) {
      pushIssues(...duplicateAndWarningIssues);

      return {
        id: row.id,
        row_number: row.row_number,
        mapped_data: row.mapped_data,
        status: "valid",
        error_message: duplicateAndWarningIssues
          .map((issue) => issue.message)
          .join("\n"),
      };
    }

    if (input.importType === "expense") {
      const expenseCategoryRaw = row.mapped_data.expense_category;
      const expenseCategory =
        typeof expenseCategoryRaw === "string"
          ? expenseCategoryRaw
          : expenseCategoryRaw == null
            ? null
            : String(expenseCategoryRaw);
      if (isFixedAssetsExpenseCategory(expenseCategory)) {
        const rowIssues = reviewIssuesFromLegacyErrorMessages({
          ctx: reviewCtx,
          mappedData: row.mapped_data,
          rowNumber: row.row_number,
          messages: [EXPENSE_REGISTER_FIXED_ASSETS_REJECTION_MESSAGE],
          severity: "error",
        });
        pushIssues(...rowIssues);

        return {
          id: row.id,
          row_number: row.row_number,
          mapped_data: row.mapped_data,
          status: "error",
          error_message: rowIssues.map((issue) => issue.message).join("\n"),
        };
      }

      const expenseCategoryWarnings = collectExpenseWarnings(row.mapped_data);

      if (
        expenseCategoryWarnings.length > 0 ||
        duplicateAndWarningIssues.length > 0
      ) {
        const categoryIssues =
          expenseCategoryWarnings.length > 0
            ? reviewIssuesFromLegacyErrorMessages({
                ctx: reviewCtx,
                mappedData: row.mapped_data,
                rowNumber: row.row_number,
                messages: expenseCategoryWarnings,
                severity: "warning",
              })
            : [];
        const rowIssues = [...categoryIssues, ...duplicateAndWarningIssues];
        pushIssues(...rowIssues);

        return {
          id: row.id,
          row_number: row.row_number,
          mapped_data: row.mapped_data,
          status: "valid",
          error_message: rowIssues.map((issue) => issue.message).join("\n"),
        };
      }
    }

    if (
      input.importType === "fixed_asset" &&
      duplicateAndWarningIssues.length > 0
    ) {
      pushIssues(...duplicateAndWarningIssues);

      return {
        id: row.id,
        row_number: row.row_number,
        mapped_data: row.mapped_data,
        status: "valid",
        error_message: duplicateAndWarningIssues
          .map((issue) => issue.message)
          .join("\n"),
      };
    }

    if (input.importType === "product") {
      const openingStockWarning = collectProductOpeningStockCostWarning({
        ctx: reviewCtx,
        mappedData: row.mapped_data,
        rowNumber: row.row_number,
      });
      if (openingStockWarning) {
        pushIssues(openingStockWarning);
        return {
          id: row.id,
          row_number: row.row_number,
          mapped_data: row.mapped_data,
          status: "valid",
          error_message: openingStockWarning.message,
        };
      }
    }

    return {
      id: row.id,
      row_number: row.row_number,
      mapped_data: row.mapped_data,
      status: "valid",
      error_message: null,
    };
  });



  const summary: BulkImportValidationSummary = {

    total_rows: validatedRows.length,

    valid_rows: validatedRows.filter((row) => row.status === "valid").length,

    error_rows: validatedRows.filter((row) => row.status === "error").length,

    duplicate_rows: validatedRows.filter((row) => row.status === "duplicate")

      .length,

    blank_rows_skipped: blankRowsSkipped,

  };



  const validRowNumbers = new Set(
    validatedRows
      .filter((row) => row.status === "valid")
      .map((row) => row.row_number),
  );

  const issueRows = allReviewIssues
    .filter((issue) => issue.severity === "error")
    .map(toReviewIssueRow);

  const warningRows = allReviewIssues
    .filter(
      (issue) =>
        issue.severity === "warning" &&
        validRowNumbers.has(issue.row_number),
    )
    .map(toReviewIssueRow);

  const missingPositions =
    input.importType === "employee" && employeeLookups
      ? summarizeMissingImportPositions(
          validatedRows
            .filter((row) => row.status === "valid")
            .map((row) => ({ mapped_data: row.mapped_data })),
          employeeLookups,
        )
      : [];

  return {
    validatedRows,
    summary,
    issueRows,
    warningRows,
    missingPositions,
  };

}


