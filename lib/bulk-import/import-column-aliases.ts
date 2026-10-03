import type { BulkImportType } from "@/lib/bulk-import/types";
import { normalizeColumnMatchKey } from "@/lib/bulk-import/bulk-import-wizard-utils";

const EMPLOYEE_CALCULATED_IGNORE_HINT =
  "Calculated by DavSuite from Salary Settings";

/** Headers that auto-map to Ignore with an explanatory note (employee import). */
export function getEmployeeImportIgnoreHeaderHints(): Map<string, string> {
  const headers = [
    "Housing Allowance",
    "Housing Allowance (GHS)",
    "Transport Allowance",
    "Transport Allowance (GHS)",
    "Other Allowances",
    "Other Allowance",
    "Other Allowances (GHS)",
    "Gross Monthly Pay",
    "Gross Monthly Pay (GHS)",
    "Net Monthly Pay",
    "Net Monthly Pay (GHS)",
    "Gross Pay",
    "Net Pay",
  ];

  const map = new Map<string, string>();
  for (const header of headers) {
    map.set(normalizeColumnMatchKey(header), EMPLOYEE_CALCULATED_IGNORE_HINT);
  }

  return map;
}

export function getBulkImportIgnoreColumnHint(
  importType: BulkImportType,
  header: string,
): string | null {
  if (importType !== "employee") {
    return null;
  }

  return getEmployeeImportIgnoreHeaderHints().get(normalizeColumnMatchKey(header)) ?? null;
}

/** Extra header → target field keys for auto-mapping (normalized keys). */
export function getBulkImportColumnAliasLookup(
  importType: BulkImportType,
): Map<string, string> {
  const lookup = new Map<string, string>();

  if (importType !== "employee") {
    return lookup;
  }

  const pairs: Array<[string, string]> = [
    ["staffid", "staff_id"],
    ["fullname", "full_name"],
    ["employeename", "full_name"],
    ["gender", "gender"],
    ["dateofbirth", "date_of_birth"],
    ["dob", "date_of_birth"],
    ["birthdate", "date_of_birth"],
    ["nationality", "nationality"],
    ["maritalstatus", "marital_status"],
    ["phonewhatsappnumber", "phone"],
    ["phone/whatsappnumber", "phone"],
    ["whatsappnumber", "phone"],
    ["mobilenumber", "phone"],
    ["emailaddress", "email"],
    ["email", "email"],
    ["residentialaddress", "residential_address"],
    ["address", "residential_address"],
    ["ghanacardnumber", "ghana_card_number"],
    ["ghanacard", "ghana_card_number"],
    ["ssnitnumber", "ssnit_number"],
    ["ssnit", "ssnit_number"],
    ["tinnumber", "tin_number"],
    ["tin", "tin_number"],
    ["bankname", "bank_name"],
    ["bankaccountnumber", "account_number"],
    ["accountnumber", "account_number"],
    ["mobilemoneynumber", "momo_number"],
    ["momonumber", "momo_number"],
    ["department", "department_name"],
    ["departmentname", "department_name"],
    ["position", "position_title"],
    ["positiontitle", "position_title"],
    ["jobtitle", "position_title"],
    ["supervisor", "supervisor_name"],
    ["supervisorname", "supervisor_name"],
    ["employmenttype", "employment_type"],
    ["datehired", "date_hired"],
    ["hiredate", "date_hired"],
    ["startdate", "date_hired"],
    ["employmentstatus", "employment_status"],
    ["contractprojectassignment", "contract_project_name"],
    ["contract/projectassignment", "contract_project_name"],
    ["projectassignment", "contract_project_name"],
    ["contractproject", "contract_project_name"],
    ["projectname", "contract_project_name"],
    ["shift", "shift"],
    ["assignedsite", "assigned_site_name"],
    ["sitename", "assigned_site_name"],
    ["appointmentenddate", "appointment_end_date"],
    ["appointementenddate", "appointment_end_date"],
    ["basicsalaryghs", "basic_salary"],
    ["basicsalary", "basic_salary"],
    ["basicpay", "basic_salary"],
    ["emergencycontactname", "emergency_contact_name"],
    ["emergencycontactaddress", "emergency_contact_address"],
    ["emergencycontactphone", "emergency_contact_phone"],
    ["emergencycontactrelationship", "emergency_contact_relationship"],
  ];

  for (const [alias, fieldKey] of pairs) {
    lookup.set(normalizeColumnMatchKey(alias), fieldKey);
  }

  return lookup;
}

export function shouldSkipBulkImportHeaderAutoMap(
  importType: BulkImportType,
  header: string,
): boolean {
  if (importType !== "employee") {
    return false;
  }

  const normalized = normalizeColumnMatchKey(header);
  if (normalized.includes("donotedit")) {
    return true;
  }

  if (normalized.startsWith("activerank")) {
    return true;
  }

  if (normalized === "datanotes") {
    return true;
  }

  return false;
}
