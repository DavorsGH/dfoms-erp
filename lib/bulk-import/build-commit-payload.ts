import {
  CUSTOMER_STATUS_OPTIONS,
  CUSTOMER_TYPE_OPTIONS,
  DEFAULT_CUSTOMER_STATUS,
  DEFAULT_CUSTOMER_TYPE,
} from "@/app/dashboard/crm/customers/customers-utils";
import { calculateAmount } from "@/app/dashboard/finance/expense-register-utils";
import {
  calculateAssetAccumulatedDepreciationAsOf,
  calculateAssetNetBookValueAsOf,
  getAssetCalculations,
  getMonthEndForDate,
} from "@/app/dashboard/finance/fixed-assets-utils";
import {
  computePurchaseTaxAmounts,
  computeWhtAmount,
  roundTaxAmount,
} from "@/app/dashboard/finance/tax-utils";
import {
  DEFAULT_EMPLOYMENT_STATUS,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  SHIFT_OPTIONS,
} from "@/app/dashboard/employees/employee-record-utils";
import { CONTRACT_STATUS_OPTIONS } from "@/app/dashboard/operations/operations-register-utils";
import { FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE } from "@/lib/bulk-import/target-fields";

const DEFAULT_SOURCING_TYPE = "manufactured" as const;

function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }

  return String(value).trim() === "";
}

function nullableText(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  return String(value).trim();
}

function parseOptionalNumber(value: unknown): number | null {
  if (isBlank(value)) {
    return null;
  }

  const parsed = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalDate(value: unknown): string | null {
  if (isBlank(value)) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

export type FinishedProductCommitInsert = {
  tenant_id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  current_stock: number;
  standard_selling_price: number | null;
  sourcing_type: typeof DEFAULT_SOURCING_TYPE | typeof FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE;
  supplier_id: string | null;
  manufacturing_date: string | null;
  expiration_date: string | null;
};

export type ServiceCatalogCommitInsert = {
  tenant_id: string;
  service_name: string;
  description: string | null;
  default_rate: number | null;
  billing_unit: string | null;
  category: string | null;
};

export type EmployeeCommitInsert = {
  tenant_id: string;
  employee_id: string;
  staff_id: string;
  full_name: string;
  gender: string | null;
  nationality: string | null;
  marital_status: string | null;
  phone: string | null;
  email: string | null;
  department: string | null;
  position: string | null;
  supervisor: string | null;
  employment_type: string;
  date_hired: string | null;
  appointment_end_date: string | null;
  employment_status: string;
  contract_project: string | null;
  shift: string | null;
  assigned_site_id: string | null;
  data_notes: string | null;
};

const EXPENSE_PAYMENT_STATUS_OPTIONS = [
  "Pending",
  "Partial",
  "Paid",
  "Overdue",
  "Accrued",
  "Accrued - Not Yet Paid",
  "Settled (No Cash Impact)",
] as const;

export type ExpenseCommitInsert = {
  tenant_id: string;
  date: string;
  expense_category: string;
  sub_category: string;
  description: string | null;
  vendor: string;
  price: number;
  quantity: number;
  amount: number;
  payment_method: string;
  approved_by: string;
  receipt_no: string;
  payment_status: string;
  gross_before_wht: number;
  wht_rate: number | null;
  wht_amount: number;
  input_vat_amount: number;
  net_of_tax_amount: number;
  notes: string | null;
  purchaseTax: ReturnType<typeof computePurchaseTaxAmounts>;
};

export type CustomerCommitInsert = {
  tenant_id: string;
  client_id: string;
  client_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  gps_location: string | null;
  contract_number: string;
  contract_start: string | null;
  contract_end: string | null;
  service_frequency: string | null;
  services_provided: string | null;
  assigned_supervisor: string | null;
  contract_status: string;
  notes: string | null;
  customer_type: string;
  status: string;
  source: "manual";
};

function resolveCanonicalEnumValue(
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
  return match ?? trimmed;
}

export function buildFinishedProductCommitInsert(
  mappedData: Record<string, unknown>,
  tenantId: string,
  resolvedSupplierId: string | null,
): FinishedProductCommitInsert {
  const sourcingRaw = String(mappedData.sourcing_type ?? "").trim().toLowerCase();
  const sourcing_type =
    sourcingRaw === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE
      ? FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE
      : DEFAULT_SOURCING_TYPE;

  const supplier_id =
    sourcing_type === FINISHED_PRODUCT_PURCHASED_SOURCING_TYPE
      ? resolvedSupplierId
      : null;

  const currentStock = parseOptionalNumber(mappedData.current_stock);

  return {
    tenant_id: tenantId,
    product_code: String(mappedData.product_code).trim(),
    product_name: String(mappedData.product_name).trim(),
    unit_of_measure: String(mappedData.unit_of_measure).trim(),
    current_stock: currentStock ?? 0,
    standard_selling_price: parseOptionalNumber(mappedData.standard_selling_price),
    sourcing_type,
    supplier_id,
    manufacturing_date: parseOptionalDate(mappedData.manufacturing_date),
    expiration_date: parseOptionalDate(mappedData.expiration_date),
  };
}

export function buildServiceCatalogCommitInsert(
  mappedData: Record<string, unknown>,
  tenantId: string,
): ServiceCatalogCommitInsert {
  return {
    tenant_id: tenantId,
    service_name: String(mappedData.service_name).trim(),
    description: nullableText(mappedData.description),
    default_rate: parseOptionalNumber(mappedData.default_rate),
    billing_unit: nullableText(mappedData.billing_unit),
    category: nullableText(mappedData.category),
  };
}

export function buildEmployeeCommitInsert(input: {
  mappedData: Record<string, unknown>;
  tenantId: string;
  employeeId: string;
  staffId: string;
  departmentCode: string | null;
  positionTitle: string | null;
  projectCode: string | null;
  supervisorId: string | null;
  assignedSiteCode: string | null;
}): EmployeeCommitInsert {
  const employmentType = resolveCanonicalEnumValue(
    input.mappedData.employment_type,
    EMPLOYMENT_TYPE_OPTIONS,
  );

  if (!employmentType) {
    throw new Error("employment_type is required.");
  }

  return {
    tenant_id: input.tenantId,
    employee_id: input.employeeId,
    staff_id: input.staffId,
    full_name: String(input.mappedData.full_name).trim(),
    gender: resolveCanonicalEnumValue(input.mappedData.gender, GENDER_OPTIONS),
    nationality: nullableText(input.mappedData.nationality),
    marital_status: resolveCanonicalEnumValue(
      input.mappedData.marital_status,
      MARITAL_STATUS_OPTIONS,
    ),
    phone: nullableText(input.mappedData.phone),
    email: nullableText(input.mappedData.email),
    department: input.departmentCode,
    position: input.positionTitle,
    supervisor: input.supervisorId,
    employment_type: employmentType,
    date_hired: parseOptionalDate(input.mappedData.date_hired),
    appointment_end_date: parseOptionalDate(input.mappedData.appointment_end_date),
    employment_status:
      resolveCanonicalEnumValue(
        input.mappedData.employment_status,
        EMPLOYMENT_STATUS_OPTIONS,
      ) ?? DEFAULT_EMPLOYMENT_STATUS,
    contract_project: input.projectCode,
    shift: resolveCanonicalEnumValue(input.mappedData.shift, SHIFT_OPTIONS),
    assigned_site_id: input.assignedSiteCode,
    data_notes: nullableText(input.mappedData.data_notes),
  };
}

const CUSTOMER_TYPE_VALUES = CUSTOMER_TYPE_OPTIONS.map((option) => option.value);
const CUSTOMER_STATUS_VALUES = CUSTOMER_STATUS_OPTIONS.map(
  (option) => option.value,
);

export function buildCustomerCommitInsert(input: {
  mappedData: Record<string, unknown>;
  tenantId: string;
  clientId: string;
  contractNumber: string;
  supervisorId: string | null;
}): CustomerCommitInsert {
  const clientName = String(input.mappedData.client_name ?? "").trim();
  if (!clientName) {
    throw new Error("client_name is required.");
  }

  return {
    tenant_id: input.tenantId,
    client_id: input.clientId,
    client_name: clientName,
    contact_person: nullableText(input.mappedData.contact_person),
    phone: nullableText(input.mappedData.phone),
    email: nullableText(input.mappedData.email),
    address: nullableText(input.mappedData.address),
    gps_location: nullableText(input.mappedData.gps_location),
    contract_number: input.contractNumber,
    contract_start: parseOptionalDate(input.mappedData.contract_start),
    contract_end: parseOptionalDate(input.mappedData.contract_end),
    service_frequency: nullableText(input.mappedData.service_frequency),
    services_provided: nullableText(input.mappedData.services_provided),
    assigned_supervisor: input.supervisorId,
    contract_status:
      resolveCanonicalEnumValue(
        input.mappedData.contract_status,
        CONTRACT_STATUS_OPTIONS,
      ) ?? "Active",
    notes: nullableText(input.mappedData.notes),
    customer_type:
      resolveCanonicalEnumValue(
        input.mappedData.customer_type,
        CUSTOMER_TYPE_VALUES,
      ) ?? DEFAULT_CUSTOMER_TYPE,
    status:
      resolveCanonicalEnumValue(input.mappedData.status, CUSTOMER_STATUS_VALUES) ??
      DEFAULT_CUSTOMER_STATUS,
    source: "manual",
  };
}

function parseRequiredDate(value: unknown, fieldKey: string): string {
  const parsed = parseOptionalDate(value);
  if (!parsed) {
    throw new Error(`${fieldKey} is required.`);
  }

  return parsed;
}

function parseExpenseQuantity(value: unknown): number {
  if (isBlank(value)) {
    return 1;
  }

  const parsed = Number(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("quantity must be a positive number.");
  }

  return parsed;
}

export function buildExpenseCommitInsert(input: {
  mappedData: Record<string, unknown>;
  tenantId: string;
  expenseCategory: string;
  subCategory: string;
  paymentMethod: string;
  approvedBy: string;
  receiptNo: string;
}): ExpenseCommitInsert {
  const vendor = String(input.mappedData.vendor ?? "").trim();
  if (!vendor) {
    throw new Error("vendor is required.");
  }

  const priceRaw = input.mappedData.price;
  if (isBlank(priceRaw)) {
    throw new Error("price is required.");
  }

  const price = Number(String(priceRaw).trim().replace(/,/g, ""));
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("price must be a positive number.");
  }

  const quantity = parseExpenseQuantity(input.mappedData.quantity);
  const grossBeforeWht = calculateAmount(price, quantity);
  const whtRate = Number(input.mappedData.wht_rate) || 0;
  const whtAmount =
    whtRate > 0 ? computeWhtAmount(grossBeforeWht, whtRate) : 0;
  const inputVatAmount = Math.max(
    0,
    roundTaxAmount(Number(input.mappedData.input_vat_amount) || 0),
  );
  const purchaseTax = computePurchaseTaxAmounts({
    grossBeforeWht,
    whtRatePct: whtRate,
    whtAmount,
    inputVatAmount,
  });

  const paymentStatus =
    resolveCanonicalEnumValue(
      input.mappedData.payment_status,
      EXPENSE_PAYMENT_STATUS_OPTIONS,
    ) ?? "Unpaid";

  return {
    tenant_id: input.tenantId,
    date: parseRequiredDate(input.mappedData.date, "date"),
    expense_category: input.expenseCategory,
    sub_category: input.subCategory,
    description: nullableText(input.mappedData.description),
    vendor,
    price,
    quantity,
    amount: purchaseTax.netPaidToSupplier,
    payment_method: input.paymentMethod,
    approved_by: input.approvedBy,
    receipt_no: input.receiptNo,
    payment_status: paymentStatus,
    gross_before_wht: purchaseTax.grossBeforeWht,
    wht_rate: whtRate > 0 ? whtRate : null,
    wht_amount: purchaseTax.whtAmount,
    input_vat_amount: purchaseTax.inputVatAmount,
    net_of_tax_amount: purchaseTax.netOfTaxAmount,
    notes: nullableText(input.mappedData.notes),
    purchaseTax,
  };
}

export type FixedAssetCommitInsert = {
  tenant_id: string;
  asset_id: string;
  asset_name: string;
  asset_category: string | null;
  purchase_date: string;
  original_cost: number;
  quantity: number;
  total_cost: number;
  useful_life_years: number | null;
  depreciation_method: string | null;
  annual_depreciation: number;
  accumulated_depreciation: number;
  net_book_value: number;
  location: string | null;
  notes: string | null;
  payment_method: string;
  vendor_name: string | null;
};

function parseFixedAssetQuantity(value: unknown): number {
  if (isBlank(value)) {
    return 1;
  }

  const parsed = Number(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("quantity must be a positive number.");
  }

  return parsed;
}

function parseOptionalUsefulLifeYears(value: unknown): number | null {
  if (isBlank(value)) {
    return null;
  }

  const parsed = Number(String(value).trim().replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("useful_life_years must be a positive number.");
  }

  return parsed;
}

/** Mirrors fixed-assets.tsx getLiveAssetValues() for the same inputs. */
export function computeFixedAssetLiveValues(input: {
  originalCost: number;
  quantity: number;
  usefulLifeYears: number;
  purchaseDate: string;
  depreciationMethod: string;
}) {
  const asOfMonthEnd = getMonthEndForDate();
  const assetInput = {
    original_cost: input.originalCost,
    quantity: input.quantity,
    useful_life_years: input.usefulLifeYears,
    purchase_date: input.purchaseDate,
    depreciation_method: input.depreciationMethod,
  };
  const referenceDate = new Date(`${asOfMonthEnd}T12:00:00`);
  const { totalCost, annualDepreciation } = getAssetCalculations(
    input.originalCost,
    input.quantity,
    input.usefulLifeYears,
    input.purchaseDate,
    input.depreciationMethod,
    referenceDate,
  );
  const accumulatedDepreciation = calculateAssetAccumulatedDepreciationAsOf(
    assetInput,
    asOfMonthEnd,
  );
  const netBookValue = calculateAssetNetBookValueAsOf(assetInput, asOfMonthEnd);

  return {
    totalCost,
    annualDepreciation,
    accumulatedDepreciation,
    netBookValue,
  };
}

export function buildFixedAssetCommitInsert(input: {
  mappedData: Record<string, unknown>;
  tenantId: string;
  assetId: string;
  assetCategory: string | null;
  depreciationMethod: string | null;
  paymentMethod: string;
}): FixedAssetCommitInsert {
  const assetName = String(input.mappedData.asset_name ?? "").trim();
  if (!assetName) {
    throw new Error("asset_name is required.");
  }

  const originalCostRaw = input.mappedData.original_cost;
  if (isBlank(originalCostRaw)) {
    throw new Error("original_cost is required.");
  }

  const originalCost = Number(String(originalCostRaw).trim().replace(/,/g, ""));
  if (!Number.isFinite(originalCost) || originalCost <= 0) {
    throw new Error("original_cost must be a positive number.");
  }

  const purchaseDate = parseRequiredDate(input.mappedData.purchase_date, "purchase_date");
  const quantity = parseFixedAssetQuantity(input.mappedData.quantity);
  const usefulLifeYearsStored = parseOptionalUsefulLifeYears(
    input.mappedData.useful_life_years,
  );
  const depreciationMethodForCalc = input.depreciationMethod ?? "";
  const usefulLifeYearsForCalc = usefulLifeYearsStored ?? 0;

  const {
    totalCost,
    annualDepreciation,
    accumulatedDepreciation,
    netBookValue,
  } = computeFixedAssetLiveValues({
    originalCost,
    quantity,
    usefulLifeYears: usefulLifeYearsForCalc,
    purchaseDate,
    depreciationMethod: depreciationMethodForCalc,
  });

  const vendorRaw = String(input.mappedData.vendor_name ?? "").trim();

  return {
    tenant_id: input.tenantId,
    asset_id: input.assetId,
    asset_name: assetName,
    asset_category: input.assetCategory,
    purchase_date: purchaseDate,
    original_cost: originalCost,
    quantity,
    total_cost: totalCost,
    useful_life_years: usefulLifeYearsStored,
    depreciation_method: input.depreciationMethod,
    annual_depreciation: annualDepreciation,
    accumulated_depreciation: accumulatedDepreciation,
    net_book_value: netBookValue,
    location: nullableText(input.mappedData.location),
    notes: nullableText(input.mappedData.notes),
    payment_method: input.paymentMethod,
    vendor_name: vendorRaw || null,
  };
}
