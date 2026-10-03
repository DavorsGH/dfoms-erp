import {

  FINISHED_PRODUCT_FIELD_DEPENDENCIES,

  FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE,

  getBulkImportTargetFields,

} from "@/lib/bulk-import/target-fields";

import { buildMappedData } from "@/lib/bulk-import/build-mapped-data";
import { parseBulkImportSpreadsheetDate } from "@/lib/bulk-import/import-spreadsheet-values";
import { isSpreadsheetPlaceholderCell } from "@/lib/spreadsheet/spreadsheet-matrix-utils";
import { validateSupplierNameLookup } from "@/lib/bulk-import/supplier-name";
import {
  buildExpenseDuplicateKey,
  buildFixedAssetDuplicateKey,
  indexInFileDuplicateExpenseKeys,
  indexInFileDuplicateFixedAssetKeys,
} from "@/lib/bulk-import/expense-duplicate-key";
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
  toReviewIssueRow,
  type BulkImportReviewIssue,
  type BulkImportReviewIssueRow,
} from "@/lib/bulk-import/bulk-import-review-issue";
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



const PG_DATE_MIN = "0001-01-01";

const PG_DATE_MAX = "5874897-12-31";



const NUMERIC_FIELD_CONSTRAINTS = {

  current_stock: { precision: 18, scale: 4 },

  standard_selling_price: { precision: 18, scale: 4 },

  default_rate: { precision: 12, scale: 2 },

  basic_salary: { precision: 12, scale: 2 },

} as const;



const NON_NEGATIVE_NUMERIC_FIELDS = new Set([

  "current_stock",

  "standard_selling_price",

  "default_rate",

]);



const PRODUCT_DATE_FIELDS = new Set(["manufacturing_date", "expiration_date"]);

const EMPLOYEE_DATE_FIELDS = new Set([
  "date_of_birth",
  "date_hired",
  "appointment_end_date",
]);
const CUSTOMER_DATE_FIELDS = new Set(["contract_start", "contract_end"]);
const EXPENSE_DATE_FIELDS = new Set(["date"]);
const FIXED_ASSET_DATE_FIELDS = new Set(["purchase_date"]);

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



function fieldLabel(fieldKey: string): string {

  return fieldKey;

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



function isValidCalendarDateParts(year: number, month: number, day: number): boolean {

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {

    return false;

  }



  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (

    parsed.getUTCFullYear() === year &&

    parsed.getUTCMonth() === month - 1 &&

    parsed.getUTCDate() === day

  );

}



function normalizeIsoDateParts(isoDate: string): string | null {

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);

  if (!match) {

    return null;

  }



  const year = Number(match[1]);

  const month = Number(match[2]);

  const day = Number(match[3]);



  if (!isValidCalendarDateParts(year, month, day)) {

    return null;

  }



  const normalized = `${match[1]}-${match[2]}-${match[3]}`;

  if (normalized < PG_DATE_MIN || normalized > PG_DATE_MAX) {

    return "out_of_range";

  }



  return normalized;

}



function parseOptionalDate(value: unknown): string | null | "invalid" | "out_of_range" {
  if (isBlank(value)) {
    return null;
  }

  return parseBulkImportSpreadsheetDate(value);
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
  options: {
    inFileDuplicateExpenseKeys: Set<string>;
    existingExpenseDuplicateKeys: Set<string>;
  },
): string[] {
  const warnings: string[] = [];

  if (
    isSpecialExpenseCategory(mappedData.expense_category) ||
    isSpecialExpenseCategory(mappedData.sub_category)
  ) {
    warnings.push(
      "Warning: this category normally auto-posts from payroll or other modules; bulk-importing it directly may cause double-counting",
    );
  }

  const duplicateKey = buildExpenseDuplicateKey({
    date: mappedData.date,
    vendor: mappedData.vendor,
    price: mappedData.price,
    expense_category: mappedData.expense_category,
    payment_method: mappedData.payment_method,
  });

  if (duplicateKey) {
    if (options.inFileDuplicateExpenseKeys.has(duplicateKey)) {
      warnings.push(
        "Warning: Possible duplicate: a similar expense (same date/supplier/price/category/payment method) appears elsewhere in this file",
      );
    }

    if (options.existingExpenseDuplicateKeys.has(duplicateKey)) {
      warnings.push(
        "Warning: Possible duplicate: a similar expense (same date/supplier/price/category/payment method) already exists",
      );
    }
  }

  return warnings;
}

function collectFixedAssetWarnings(
  mappedData: Record<string, unknown>,
  options: {
    inFileDuplicateFixedAssetKeys: Set<string>;
    existingFixedAssetDuplicateKeys: Set<string>;
  },
): string[] {
  const warnings: string[] = [];

  const duplicateKey = buildFixedAssetDuplicateKey({
    asset_name: mappedData.asset_name,
    purchase_date: mappedData.purchase_date,
    original_cost: mappedData.original_cost,
  });

  if (duplicateKey) {
    if (options.inFileDuplicateFixedAssetKeys.has(duplicateKey)) {
      warnings.push(
        "Warning: Possible duplicate: a similar fixed asset (same name/purchase date/original cost) appears elsewhere in this file",
      );
    }

    if (options.existingFixedAssetDuplicateKeys.has(duplicateKey)) {
      warnings.push(
        "Warning: Possible duplicate: a similar fixed asset (same name/purchase date/original cost) already exists",
      );
    }
  }

  return warnings;
}



function collectFieldErrors(
  importType: BulkImportType,
  mappedData: Record<string, unknown>,
  lookups: BulkImportValidationLookups,
): string[] {

  const errors: string[] = [];

  const targetFields = getBulkImportTargetFields(importType);



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



    for (const fieldKey of PRODUCT_DATE_FIELDS) {

      if (!(fieldKey in mappedData)) {

        continue;

      }



      const parsed = parseOptionalDate(mappedData[fieldKey]);

      if (parsed === "invalid") {

        errors.push(`${fieldLabel(fieldKey)} is not a valid date`);

      } else if (parsed === "out_of_range") {

        errors.push(`${fieldLabel(fieldKey)} is outside the allowed date range`);

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



    const manufacturingDate = parseOptionalDate(mappedData.manufacturing_date);

    const expirationDate = parseOptionalDate(mappedData.expiration_date);

    if (

      manufacturingDate &&

      manufacturingDate !== "invalid" &&

      manufacturingDate !== "out_of_range" &&

      expirationDate &&

      expirationDate !== "invalid" &&

      expirationDate !== "out_of_range" &&

      expirationDate < manufacturingDate

    ) {

      errors.push("expiration_date cannot be before manufacturing_date");

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

    for (const fieldKey of CUSTOMER_DATE_FIELDS) {
      if (!(fieldKey in mappedData)) {
        continue;
      }

      const parsed = parseOptionalDate(mappedData[fieldKey]);
      if (parsed === "invalid") {
        errors.push(`${fieldLabel(fieldKey)} is not a valid date`);
      } else if (parsed === "out_of_range") {
        errors.push(`${fieldLabel(fieldKey)} is outside the allowed date range`);
      }
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

    for (const fieldKey of EXPENSE_DATE_FIELDS) {
      if (!(fieldKey in mappedData)) {
        continue;
      }

      const parsed = parseOptionalDate(mappedData[fieldKey]);
      if (parsed === "invalid") {
        errors.push(`${fieldLabel(fieldKey)} is not a valid date`);
      } else if (parsed === "out_of_range") {
        errors.push(`${fieldLabel(fieldKey)} is outside the allowed date range`);
      }
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

    for (const fieldKey of FIXED_ASSET_DATE_FIELDS) {
      if (!(fieldKey in mappedData)) {
        continue;
      }

      const parsed = parseOptionalDate(mappedData[fieldKey]);
      if (parsed === "invalid") {
        errors.push(`${fieldLabel(fieldKey)} is not a valid date`);
      } else if (parsed === "out_of_range") {
        errors.push(`${fieldLabel(fieldKey)} is outside the allowed date range`);
      }
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



  return errors;

}



function collectServiceWarnings(

  mappedData: Record<string, unknown>,

  inFileDuplicateServiceNames: Set<string>,

  existingServiceNames: Set<string>,

): string[] {

  const serviceName = String(mappedData.service_name ?? "").trim();

  if (!serviceName) {

    return [];

  }



  const key = normalizedKey(serviceName);

  const warnings: string[] = [];



  if (inFileDuplicateServiceNames.has(key)) {

    warnings.push("Warning: duplicate service_name in this file");

  }



  if (existingServiceNames.has(key)) {

    warnings.push("Warning: service_name already exists in service catalog");

  }



  return warnings;

}



function collectProductDuplicateMessage(

  mappedData: Record<string, unknown>,

  inFileDuplicateProductCodes: Set<string>,

  existingProductCodes: Set<string>,

): string | null {

  const productCode = String(mappedData.product_code ?? "").trim();

  if (!productCode) {

    return null;

  }



  const key = normalizedKey(productCode);

  const messages: string[] = [];



  if (inFileDuplicateProductCodes.has(key)) {

    messages.push("duplicate product_code: repeated in this file");

  }



  if (existingProductCodes.has(key)) {

    messages.push("duplicate product_code: already exists in Inventory");

  }



  return messages.length > 0 ? messages.join("; ") : null;

}



function indexDuplicateKeys(

  rows: Array<{ row_number: number; mapped_data: Record<string, unknown> }>,

  fieldKey: string,

): Set<string> {

  const counts = new Map<string, number>();



  for (const row of rows) {

    const value = String(row.mapped_data[fieldKey] ?? "").trim();

    if (!value) {

      continue;

    }



    const key = normalizedKey(value);

    counts.set(key, (counts.get(key) ?? 0) + 1);

  }



  return new Set(

    [...counts.entries()]

      .filter(([, count]) => count > 1)

      .map(([key]) => key),

  );

}



export function validateImportRows(input: {
  importType: BulkImportType;
  columnMapping: BulkImportColumnMapping;
  rows: ImportRowInput[];
  existingProductCodes?: Set<string>;
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



  const inFileDuplicateProductCodes =

    input.importType === "product"

      ? indexDuplicateKeys(stagedRows, "product_code")

      : new Set<string>();



  const inFileDuplicateServiceNames =

    input.importType === "service"

      ? indexDuplicateKeys(stagedRows, "service_name")

      : new Set<string>();

  const inFileDuplicateStaffIds =
    input.importType === "employee"
      ? indexDuplicateKeys(stagedRows, "staff_id")
      : new Set<string>();

  const inFileDuplicateExpenseKeys =
    input.importType === "expense"
      ? indexInFileDuplicateExpenseKeys(stagedRows)
      : new Set<string>();

  const existingExpenseDuplicateKeys =
    input.importType === "expense"
      ? (expenseLookups?.existingExpenseDuplicateKeys ?? new Set<string>())
      : new Set<string>();

  const inFileDuplicateFixedAssetKeys =
    input.importType === "fixed_asset"
      ? indexInFileDuplicateFixedAssetKeys(stagedRows)
      : new Set<string>();

  const existingFixedAssetDuplicateKeys =
    input.importType === "fixed_asset"
      ? (fixedAssetLookups?.existingFixedAssetDuplicateKeys ?? new Set<string>())
      : new Set<string>();



  const validatedRows: BulkImportValidatedRow[] = stagedRows.map((row) => {
    const pushIssues = (...issues: BulkImportReviewIssue[]) => {
      allReviewIssues.push(...issues);
    };

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
        inFileDuplicateStaffIds,
      });
      pushIssues(...rowIssues);

      const errors = rowIssues.filter((issue) => issue.severity === "error");
      if (errors.length > 0) {
        return {
          id: row.id,
          row_number: row.row_number,
          mapped_data: row.mapped_data,
          status: "error",
          error_message: errors.map((issue) => issue.message).join("\n"),
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

    const hardErrors = collectFieldErrors(
      input.importType,
      row.mapped_data,
      validationLookups,
    );

    if (hardErrors.length > 0) {
      const rowIssues = reviewIssuesFromLegacyErrorMessages({
        ctx: reviewCtx,
        mappedData: row.mapped_data,
        rowNumber: row.row_number,
        messages: hardErrors,
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

    if (input.importType === "product") {
      const duplicateMessage = collectProductDuplicateMessage(
        row.mapped_data,
        inFileDuplicateProductCodes,
        existingProductCodes,
      );

      if (duplicateMessage) {
        const rowIssues = reviewIssuesFromLegacyErrorMessages({
          ctx: reviewCtx,
          mappedData: row.mapped_data,
          rowNumber: row.row_number,
          messages: [duplicateMessage],
          severity: "error",
        });
        pushIssues(...rowIssues);

        return {
          id: row.id,
          row_number: row.row_number,
          mapped_data: row.mapped_data,
          status: "duplicate",
          error_message: rowIssues.map((issue) => issue.message).join("\n"),
        };
      }
    }

    if (input.importType === "service") {
      const warnings = collectServiceWarnings(
        row.mapped_data,
        inFileDuplicateServiceNames,
        existingServiceNames,
      );

      if (warnings.length > 0) {
        const rowIssues = reviewIssuesFromLegacyErrorMessages({
          ctx: reviewCtx,
          mappedData: row.mapped_data,
          rowNumber: row.row_number,
          messages: warnings,
          severity: "warning",
        });
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

      const warnings = collectExpenseWarnings(row.mapped_data, {
        inFileDuplicateExpenseKeys,
        existingExpenseDuplicateKeys,
      });

      if (warnings.length > 0) {
        const rowIssues = reviewIssuesFromLegacyErrorMessages({
          ctx: reviewCtx,
          mappedData: row.mapped_data,
          rowNumber: row.row_number,
          messages: warnings,
          severity: "warning",
        });
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

    if (input.importType === "fixed_asset") {
      const warnings = collectFixedAssetWarnings(row.mapped_data, {
        inFileDuplicateFixedAssetKeys,
        existingFixedAssetDuplicateKeys,
      });

      if (warnings.length > 0) {
        const rowIssues = reviewIssuesFromLegacyErrorMessages({
          ctx: reviewCtx,
          mappedData: row.mapped_data,
          rowNumber: row.row_number,
          messages: warnings,
          severity: "warning",
        });
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


