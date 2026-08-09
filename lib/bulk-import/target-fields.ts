import type { BulkImportTargetField, BulkImportType } from "@/lib/bulk-import/types";

/**
 * finished_products.sourcing_type value for purchased products
 * (FinishedProductSourcingType in finished-products-utils.ts).
 */
export const FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE = "purchased" as const;

/**
 * Phase 4 row validation: when mapped sourcing_type resolves to "purchased",
 * supplier_name is required for that row. Commit resolves the name to supplier_id.
 */
export const FINISHED_PRODUCT_FIELD_DEPENDENCIES = [
  {
    field: "supplier_name",
    requiredWhen: {
      dependsOnField: "sourcing_type",
      equals: FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE,
    },
  },
] as const;

/**
 * service_catalog columns for bulk import mapping (Phase 1 spec).
 * service_name is required; others optional.
 */
export const SERVICE_CATALOG_TARGET_FIELDS: readonly BulkImportTargetField[] = [
  {
    key: "service_name",
    label: "Service name",
    required: true,
    example: "Office cleaning",
  },
  {
    key: "description",
    label: "Description",
    required: false,
    example: "Monthly deep clean",
  },
  {
    key: "default_rate",
    label: "Default rate",
    required: false,
    example: "150.00",
  },
  {
    key: "billing_unit",
    label: "Billing unit",
    required: false,
    example: "per visit",
  },
  {
    key: "category",
    label: "Category",
    required: false,
    example: "Facilities",
  },
];

/**
 * finished_products mappable columns derived from repo schema + insert code.
 *
 * Sources:
 * - scripts/38_sales_inventory_foundation.sql (CREATE TABLE)
 * - scripts/140_finished_product_dates.sql (manufacturing_date, expiration_date)
 * - app/dashboard/inventory/finished-products-utils.ts (sourcing_type, supplier_id
 *   in buildFinishedProductSavePayload; supplier_id resolved at commit from name)
 *
 * Excluded system / auto-set columns: id, tenant_id, created_at, updated_at.
 * Excluded from migration mapping: is_archived (archive state is not imported).
 *
 * Required = NOT NULL with no DEFAULT in migration DDL (script 38).
 * supplier_name: import-facing alias for suppliers.name; commit resolves to
 * supplier_id (lookup or auto-create). Required per row when sourcing_type is
 * "purchased" — see FINISHED_PRODUCT_FIELD_DEPENDENCIES and mappingHint below.
 */
export const FINISHED_PRODUCT_TARGET_FIELDS: readonly BulkImportTargetField[] = [
  {
    key: "product_code",
    label: "Product code",
    required: true,
    example: "SKU-1001",
  },
  {
    key: "product_name",
    label: "Product name",
    required: true,
    example: "Widget A",
  },
  {
    key: "unit_of_measure",
    label: "Unit of measure",
    required: true,
    example: "pcs",
  },
  {
    key: "current_stock",
    label: "Current stock",
    required: false,
    example: "100",
  },
  {
    key: "standard_selling_price",
    label: "Standard selling price",
    required: false,
    example: "25.00",
  },
  {
    key: "sourcing_type",
    label: "Sourcing type",
    required: false,
    example: "purchased",
  },
  {
    key: "supplier_name",
    label: "Supplier name",
    required: false,
    example: "Ghana Beverages Ltd",
    mappingHint: "Supplier's name (not an ID); required if sourcing type is purchased",
    requiredWhen: {
      dependsOnField: "sourcing_type",
      equals: FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE,
    },
  },
  {
    key: "manufacturing_date",
    label: "Manufacturing date",
    required: false,
    example: "2026-01-15",
  },
  {
    key: "expiration_date",
    label: "Expiration date",
    required: false,
    example: "2027-01-15",
  },
];

/**
 * employees mappable columns for bulk import (HR migration).
 *
 * Excluded: employee_id, staff_id, tenant_id, photo_url, compensation fields,
 * statutory/payment fields, date_of_birth, residential_address, emergency contacts.
 *
 * department_name, position_title, contract_project_name resolve at commit
 * (lookup or auto-create). supervisor_name and assigned_site_name resolve at
 * commit when uniquely matched; blank when unmatched.
 */
export const EMPLOYEE_TARGET_FIELDS: readonly BulkImportTargetField[] = [
  {
    key: "full_name",
    label: "Full name",
    required: true,
    example: "Jane Doe",
  },
  {
    key: "employment_type",
    label: "Employment type",
    required: true,
    example: "Full-Time",
    mappingHint: "Casual, Part-Time, Full-Time, or Contract",
  },
  {
    key: "gender",
    label: "Gender",
    required: false,
    example: "Female",
  },
  {
    key: "nationality",
    label: "Nationality",
    required: false,
    example: "Ghanaian",
  },
  {
    key: "marital_status",
    label: "Marital status",
    required: false,
    example: "Married",
  },
  {
    key: "phone",
    label: "Phone",
    required: false,
    example: "+233 24 123 4567",
  },
  {
    key: "email",
    label: "Email",
    required: false,
    example: "jane.doe@company.com",
  },
  {
    key: "department_name",
    label: "Department name",
    required: false,
    example: "Operations",
    mappingHint: "Department name (not code); auto-created at import if missing",
  },
  {
    key: "position_title",
    label: "Position title",
    required: false,
    example: "Site Supervisor",
    mappingHint: "Position title (not code); auto-created at import if missing",
  },
  {
    key: "supervisor_name",
    label: "Supervisor name",
    required: false,
    example: "John Smith",
    mappingHint: "Supervisor's full name; left blank at import if not found",
  },
  {
    key: "date_hired",
    label: "Date hired",
    required: false,
    example: "2024-03-01",
  },
  {
    key: "appointment_end_date",
    label: "Appointment end date",
    required: false,
    example: "2025-12-31",
  },
  {
    key: "employment_status",
    label: "Employment status",
    required: false,
    example: "Active",
    mappingHint: "Active, Inactive, or Terminated (defaults to Active if blank)",
  },
  {
    key: "contract_project_name",
    label: "Contract project name",
    required: false,
    example: "Accra Mall Cleaning",
    mappingHint: "Project name (not code); auto-created at import if missing",
  },
  {
    key: "shift",
    label: "Shift",
    required: false,
    example: "Morning",
  },
  {
    key: "assigned_site_name",
    label: "Assigned site name",
    required: false,
    example: "Accra Mall",
    mappingHint: "Site name (not code); left blank at import if not found",
  },
  {
    key: "data_notes",
    label: "Data notes",
    required: false,
    example: "Transferred from Kumasi branch",
  },
];

const TARGET_FIELDS_BY_TYPE: Record<
  BulkImportType,
  readonly BulkImportTargetField[]
> = {
  product: FINISHED_PRODUCT_TARGET_FIELDS,
  service: SERVICE_CATALOG_TARGET_FIELDS,
  employee: EMPLOYEE_TARGET_FIELDS,
};

export function getBulkImportTargetFields(
  importType: BulkImportType,
): readonly BulkImportTargetField[] {
  return TARGET_FIELDS_BY_TYPE[importType];
}

export function isValidBulkImportTargetField(
  importType: BulkImportType,
  fieldKey: string,
): boolean {
  return getBulkImportTargetFields(importType).some((field) => field.key === fieldKey);
}

export function getBulkImportTargetFieldKeys(
  importType: BulkImportType,
): readonly string[] {
  return getBulkImportTargetFields(importType).map((field) => field.key);
}

export function getBulkImportTargetField(
  importType: BulkImportType,
  fieldKey: string,
): BulkImportTargetField | undefined {
  return getBulkImportTargetFields(importType).find((field) => field.key === fieldKey);
}
