import {
  DEFAULT_EMPLOYMENT_STATUS,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  SHIFT_OPTIONS,
} from "@/app/dashboard/employees/employee-record-utils";
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
