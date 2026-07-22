export type EmployeeRecord = {
  employee_id: string;
  staff_id: string;
  full_name: string;
  gender: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  marital_status: string | null;
  phone: string | null;
  email: string | null;
  residential_address: string | null;
  ghana_card_number: string | null;
  ssnit_number: string | null;
  tin_number: string | null;
  bank_name: string | null;
  account_number: string | null;
  momo_number: string | null;
  department: string | null;
  position: string | null;
  supervisor: string | null;
  employment_type: string | null;
  date_hired: string | null;
  appointment_end_date: string | null;
  employment_status: string | null;
  contract_project: string | null;
  shift: string | null;
  assigned_site_id: string | null;
  basic_salary: number | null;
  housing_allowance: number | null;
  transport_allowance: number | null;
  other_allowances: number | null;
  emergency_contact_name: string | null;
  emergency_contact_address: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  data_notes: string | null;
  photo_url: string | null;
  department_ref?: {
    dept_code: string;
    department_name: string;
  } | null;
  project_ref?: {
    project_code: string;
    project_name: string;
  } | null;
};

export const EMPLOYEE_SELECT =
  "*, department_ref:departments!employees_department_fkey(dept_code, department_name), project_ref:projects!contract_project(project_code, project_name)";

export type SiteLookup = {
  id: string;
  name: string;
};

export const GENDER_OPTIONS = ["Male", "Female"] as const;

export const MARITAL_STATUS_OPTIONS = [
  "Single",
  "Married",
  "Divorced",
  "Widowed",
  "Single Parent",
] as const;

export const EMPLOYMENT_TYPE_OPTIONS = [
  "Casual",
  "Part-Time",
  "Full-Time",
] as const;

export const SHIFT_OPTIONS = ["Full Day", "Morning", "Afternoon"] as const;

export const EMPLOYMENT_STATUS_OPTIONS = [
  "Active",
  "Inactive",
  "Terminated",
] as const;

export const DEFAULT_EMPLOYMENT_STATUS = "Active";

export function parseStaffIdNumber(staffId: string): number {
  const legacy = staffId.match(/^DF(\d+)$/i);
  if (legacy) {
    return Number.parseInt(legacy[1], 10);
  }

  const branded = staffId.match(/^[A-Z0-9]{2,5}-STAFF-(\d+)$/i);
  if (branded) {
    return Number.parseInt(branded[1], 10);
  }

  return Number.NaN;
}

export function compareStaffIds(a: string, b: string): number {
  const aNumber = parseStaffIdNumber(a);
  const bNumber = parseStaffIdNumber(b);

  if (!Number.isNaN(aNumber) && !Number.isNaN(bNumber)) {
    return aNumber - bNumber;
  }

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function formatGHS(value: number | null | undefined): string {
  return `GHS ${(Number(value) || 0).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** @deprecated Legacy EMP0001 max+1 helper; new employees use generate_next_code('EMP'). */
export function generateNextEmployeeId(existingIds: string[]): string {
  const numbers = existingIds.map((id) => {
    const match = id.match(/^EMP(\d+)$/i);
    return match ? Number.parseInt(match[1], 10) : 0;
  });
  const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;

  return `EMP${String(maxNumber + 1).padStart(4, "0")}`;
}

export function getUniqueValues(
  employees: EmployeeRecord[],
  field: "employment_status",
): string[] {
  const values = new Set<string>();

  for (const employee of employees) {
    const value = employee[field]?.trim();
    if (value) {
      values.add(value);
    }
  }

  return [...values].sort((a, b) => a.localeCompare(b));
}

export const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";
