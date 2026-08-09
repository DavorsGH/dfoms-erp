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

/**
 * customers mappable columns for bulk import (CRM migration).
 *
 * Excluded: client_id, contract_number, tenant_id, email_verified, source.
 * supervisor_name resolves at commit to assigned_supervisor (employee_id).
 */
export const CUSTOMER_TARGET_FIELDS: readonly BulkImportTargetField[] = [
  {
    key: "client_name",
    label: "Client name",
    required: true,
    example: "Acme Facilities Ltd",
  },
  {
    key: "contact_person",
    label: "Contact person",
    required: false,
    example: "Jane Doe",
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
    example: "contact@acme.com",
  },
  {
    key: "address",
    label: "Address",
    required: false,
    example: "12 Independence Ave, Accra",
  },
  {
    key: "gps_location",
    label: "GPS location",
    required: false,
    example: "5.6037, -0.1870",
  },
  {
    key: "contract_start",
    label: "Contract start",
    required: false,
    example: "2024-01-01",
  },
  {
    key: "contract_end",
    label: "Contract end",
    required: false,
    example: "2025-12-31",
  },
  {
    key: "service_frequency",
    label: "Service frequency",
    required: false,
    example: "Monthly",
  },
  {
    key: "services_provided",
    label: "Services provided",
    required: false,
    example: "Office cleaning, pest control",
  },
  {
    key: "supervisor_name",
    label: "Supervisor name",
    required: false,
    example: "John Smith",
    mappingHint: "Supervisor's full name; left blank at import if not found",
  },
  {
    key: "contract_status",
    label: "Contract status",
    required: false,
    example: "Active",
    mappingHint: "Active, Expired, Terminated, or Pending (defaults to Active if blank)",
  },
  {
    key: "customer_type",
    label: "Customer type",
    required: false,
    example: "service_client",
    mappingHint: "service_client, digital_subscriber, or both (defaults to service_client if blank)",
  },
  {
    key: "status",
    label: "Status",
    required: false,
    example: "active",
    mappingHint: "lead, active, or inactive (defaults to active if blank)",
  },
  {
    key: "notes",
    label: "Notes",
    required: false,
    example: "Transferred from legacy CRM",
  },
];

/**
 * expense_register mappable columns for bulk import (finance migration).
 *
 * Excluded system/computed columns: tenant_id, amount, gross_before_wht,
 * wht_amount, net_of_tax_amount (derived at commit via computePurchaseTaxAmounts).
 *
 * expense_category, sub_category, approved_by resolve at commit (lookup or
 * auto-create). payment_method must match an existing tenant payment method.
 */
export const EXPENSE_TARGET_FIELDS: readonly BulkImportTargetField[] = [
  {
    key: "date",
    label: "Date",
    required: true,
    example: "2024-03-15",
  },
  {
    key: "expense_category",
    label: "Expense category",
    required: true,
    example: "Administrative",
    mappingHint: "Category name (not code); auto-created at import if missing",
  },
  {
    key: "sub_category",
    label: "Sub-category",
    required: true,
    example: "Office Supplies",
    mappingHint: "Sub-category name (not code); auto-created at import if missing",
  },
  {
    key: "vendor",
    label: "Vendor",
    required: true,
    example: "ABC Supplies Ltd",
  },
  {
    key: "price",
    label: "Price",
    required: true,
    example: "150.00",
    mappingHint: "Unit price before WHT (gross line = Price × Quantity)",
  },
  {
    key: "payment_method",
    label: "Payment method",
    required: true,
    example: "Bank Transfer",
    mappingHint: "Must match an existing payment method for this tenant",
  },
  {
    key: "approved_by",
    label: "Approved by",
    required: true,
    example: "Jane Doe",
    mappingHint: "Approver full name; auto-created at import if missing",
  },
  {
    key: "payment_status",
    label: "Payment status",
    required: true,
    example: "Paid",
    mappingHint:
      "Pending, Partial, Paid, Overdue, Accrued, Accrued - Not Yet Paid, or Settled (No Cash Impact)",
  },
  {
    key: "description",
    label: "Description",
    required: false,
    example: "Monthly stationery order",
  },
  {
    key: "quantity",
    label: "Quantity",
    required: false,
    example: "1",
    mappingHint: "Defaults to 1 if blank",
  },
  {
    key: "receipt_no",
    label: "Receipt no.",
    required: false,
    example: "INV-2024-001",
    mappingHint:
      "Leave blank to auto-assign (e.g. DF-EXP-0001), or enter vendor paper receipt #",
  },
  {
    key: "wht_rate",
    label: "WHT rate (%)",
    required: false,
    example: "7.5",
  },
  {
    key: "input_vat_amount",
    label: "Input VAT amount",
    required: false,
    example: "22.50",
    mappingHint: "Reclaimable input VAT amount (not a rate)",
  },
  {
    key: "notes",
    label: "Notes",
    required: false,
    example: "Imported from legacy ledger",
  },
];

/**
 * fixed_assets mappable columns for bulk import (finance migration).
 *
 * Excluded system/computed columns: asset_id, tenant_id, total_cost,
 * annual_depreciation, accumulated_depreciation, net_book_value,
 * annual_dep_rate_pct, accounts_payable_id.
 *
 * asset_category and depreciation_method resolve at commit (lookup or
 * auto-create). payment_method must match an existing tenant payment method.
 */
export const FIXED_ASSET_TARGET_FIELDS: readonly BulkImportTargetField[] = [
  {
    key: "asset_name",
    label: "Asset name",
    required: true,
    example: "Office desk",
  },
  {
    key: "purchase_date",
    label: "Purchase date",
    required: true,
    example: "2024-03-15",
  },
  {
    key: "original_cost",
    label: "Original cost",
    required: true,
    example: "1500.00",
    mappingHint: "Unit cost before quantity (numeric 12,2)",
  },
  {
    key: "payment_method",
    label: "Payment method",
    required: true,
    example: "Bank Transfer",
    mappingHint: "Must match an existing payment method for this tenant",
  },
  {
    key: "asset_category",
    label: "Asset category",
    required: false,
    example: "Furniture",
    mappingHint: "Category name; auto-created at import if missing",
  },
  {
    key: "quantity",
    label: "Quantity",
    required: false,
    example: "1",
    mappingHint: "Defaults to 1 if blank",
  },
  {
    key: "useful_life_years",
    label: "Useful life (years)",
    required: false,
    example: "5",
  },
  {
    key: "depreciation_method",
    label: "Depreciation method",
    required: false,
    example: "Straight Line",
    mappingHint: "Method name; auto-created at import if missing",
  },
  {
    key: "location",
    label: "Location",
    required: false,
    example: "Head Office",
  },
  {
    key: "notes",
    label: "Notes",
    required: false,
    example: "Imported from legacy register",
  },
  {
    key: "vendor_name",
    label: "Vendor name",
    required: false,
    example: "ABC Furniture Ltd",
    mappingHint: "Required when payment method is credit / on account",
  },
];

const TARGET_FIELDS_BY_TYPE: Record<
  BulkImportType,
  readonly BulkImportTargetField[]
> = {
  product: FINISHED_PRODUCT_TARGET_FIELDS,
  service: SERVICE_CATALOG_TARGET_FIELDS,
  employee: EMPLOYEE_TARGET_FIELDS,
  customer: CUSTOMER_TARGET_FIELDS,
  expense: EXPENSE_TARGET_FIELDS,
  fixed_asset: FIXED_ASSET_TARGET_FIELDS,
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
