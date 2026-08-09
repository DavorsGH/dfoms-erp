import {

  FINISHED_PRODUCT_FIELD_DEPENDENCIES,

  FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE,

  getBulkImportTargetFields,

} from "@/lib/bulk-import/target-fields";

import { buildMappedData } from "@/lib/bulk-import/build-mapped-data";
import { validateSupplierNameLookup } from "@/lib/bulk-import/supplier-name";
import { validateTenantNameLookup } from "@/lib/bulk-import/tenant-name-lookup";
import {
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  SHIFT_OPTIONS,
} from "@/app/dashboard/employees/employee-record-utils";

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

};



type ImportRowInput = {

  id: string;

  row_number: number;

  raw_data: Record<string, unknown>;

};



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

} as const;



const NON_NEGATIVE_NUMERIC_FIELDS = new Set([

  "current_stock",

  "standard_selling_price",

  "default_rate",

]);



const PRODUCT_DATE_FIELDS = new Set(["manufacturing_date", "expiration_date"]);

const EMPLOYEE_DATE_FIELDS = new Set(["date_hired", "appointment_end_date"]);

export type EmployeeImportLookupContext = {
  departmentNameMatchCounts: Map<string, number>;
  positionTitleMatchCounts: Map<string, number>;
  contractProjectNameMatchCounts: Map<string, number>;
  supervisorNameMatchCounts: Map<string, number>;
  assignedSiteNameMatchCounts: Map<string, number>;
};

type BulkImportValidationLookups = {
  supplierNameMatchCounts: Map<string, number>;
  employeeLookups: EmployeeImportLookupContext | null;
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



  if (value instanceof Date && !Number.isNaN(value.getTime())) {

    const iso = value.toISOString().slice(0, 10);

    const normalized = normalizeIsoDateParts(iso);

    if (normalized === "out_of_range") {

      return "out_of_range";

    }

    return normalized ?? "invalid";

  }



  const trimmed = String(value).trim();

  const isoMatch = normalizeIsoDateParts(trimmed);

  if (isoMatch && isoMatch !== "out_of_range") {

    return isoMatch;

  }

  if (isoMatch === "out_of_range") {

    return "out_of_range";

  }



  const parsed = new Date(trimmed);

  if (Number.isNaN(parsed.getTime())) {

    return "invalid";

  }



  const iso = parsed.toISOString().slice(0, 10);

  const normalized = normalizeIsoDateParts(iso);

  if (normalized === "out_of_range") {

    return "out_of_range";

  }



  return normalized ?? "invalid";

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
    const employeeLookups = lookups.employeeLookups;
    if (!employeeLookups) {
      throw new Error("Employee import validation requires lookup context.");
    }

    for (const fieldKey of EMPLOYEE_DATE_FIELDS) {
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
      ["employment_type", EMPLOYMENT_TYPE_OPTIONS],
      ["employment_status", EMPLOYMENT_STATUS_OPTIONS],
      ["gender", GENDER_OPTIONS],
      ["marital_status", MARITAL_STATUS_OPTIONS],
      ["shift", SHIFT_OPTIONS],
    ];

    for (const [fieldKey, allowedValues] of enumChecks) {
      if (!(fieldKey in mappedData)) {
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

    const nameLookups: Array<[string, Map<string, number>, string]> = [
      ["department_name", employeeLookups.departmentNameMatchCounts, "departments"],
      ["position_title", employeeLookups.positionTitleMatchCounts, "positions"],
      [
        "contract_project_name",
        employeeLookups.contractProjectNameMatchCounts,
        "projects",
      ],
      ["supervisor_name", employeeLookups.supervisorNameMatchCounts, "employees"],
      ["assigned_site_name", employeeLookups.assignedSiteNameMatchCounts, "sites"],
    ];

    for (const [fieldKey, matchCounts, entityLabel] of nameLookups) {
      if (!(fieldKey in mappedData)) {
        continue;
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
}): {

  validatedRows: BulkImportValidatedRow[];

  summary: BulkImportValidationSummary;

  issueRows: Array<{ row_number: number; error_message: string }>;

} {

  const existingProductCodes =

    input.existingProductCodes ?? new Set<string>();

  const existingServiceNames =
    input.existingServiceNames ?? new Set<string>();
  const supplierNameMatchCounts =
    input.supplierNameMatchCounts ?? new Map<string, number>();
  const employeeLookups =
    input.importType === "employee" ? (input.employeeLookups ?? null) : null;
  const validationLookups: BulkImportValidationLookups = {
    supplierNameMatchCounts,
    employeeLookups,
  };



  const stagedRows = input.rows.map((row) => ({

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



  const validatedRows: BulkImportValidatedRow[] = stagedRows.map((row) => {

    const hardErrors = collectFieldErrors(
      input.importType,
      row.mapped_data,
      validationLookups,
    );



    if (hardErrors.length > 0) {

      return {

        id: row.id,

        row_number: row.row_number,

        mapped_data: row.mapped_data,

        status: "error",

        error_message: hardErrors.join("; "),

      };

    }



    if (input.importType === "product") {

      const duplicateMessage = collectProductDuplicateMessage(

        row.mapped_data,

        inFileDuplicateProductCodes,

        existingProductCodes,

      );



      if (duplicateMessage) {

        return {

          id: row.id,

          row_number: row.row_number,

          mapped_data: row.mapped_data,

          status: "duplicate",

          error_message: duplicateMessage,

        };

      }

    }



    if (input.importType === "service") {

      const warnings = collectServiceWarnings(

        row.mapped_data,

        inFileDuplicateServiceNames,

        existingServiceNames,

      );



      return {

        id: row.id,

        row_number: row.row_number,

        mapped_data: row.mapped_data,

        status: "valid",

        error_message: warnings.length > 0 ? warnings.join("; ") : null,

      };

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

  };



  const issueRows = validatedRows

    .filter((row) => row.status === "error" || row.status === "duplicate")

    .map((row) => ({

      row_number: row.row_number,

      error_message: row.error_message ?? "",

    }));



  return { validatedRows, summary, issueRows };

}


