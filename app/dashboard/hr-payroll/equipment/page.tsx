import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  applyEmployeeIdScopeToColumn,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import EquipmentRegister from "../equipment-register";
import {
  DEFAULT_EQUIPMENT_STATUS,
  EQUIPMENT_REGISTER_SELECT,
  EQUIPMENT_SITE_SELECT,
  EQUIPMENT_STATUS_OPTIONS_SELECT,
  type EquipmentRegisterEntry,
  type EquipmentSiteOption,
} from "../equipment-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function EquipmentRegisterPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { employeeIds, error: employeeScopeError } = tenantId
    ? await fetchScopedEmployeeIds(supabase, tenantId, buScope)
    : {
        employeeIds: buScope.mode === "all" ? null : [],
        error:
          buScope.mode === "all"
            ? null
            : "Unable to resolve your workspace.",
      };

  const [
    { data, error },
    { data: employees, error: employeesError },
    { data: sites, error: sitesError },
    { data: statusRows, error: statusError },
  ] = await Promise.all([
    applyEmployeeIdScopeToColumn(
      supabase
        .from("equipment_register")
        .select(EQUIPMENT_REGISTER_SELECT),
      employeeIds,
      "assigned_to",
    ).order("equipment_id", { ascending: true }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    supabase
      .from("sites")
      .select(EQUIPMENT_SITE_SELECT)
      .order("site_name", { ascending: true }),
    supabase
      .from("equipment_status_options")
      .select(EQUIPMENT_STATUS_OPTIONS_SELECT)
      .order("name", { ascending: true }),
  ]);

  const fetchError =
    employeeScopeError ??
    error?.message ??
    employeesError?.message ??
    sitesError?.message ??
    statusError?.message ??
    null;

  const statusOptions = [
    ...new Set(
      ((statusRows as { name: string }[] | null) ?? [])
        .map((row) => row.name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (
    statusOptions.length === 0 ||
    !statusOptions.includes(DEFAULT_EQUIPMENT_STATUS)
  ) {
    statusOptions.unshift(DEFAULT_EQUIPMENT_STATUS);
  }

  return (
    <HrPayrollShell sectionTitle="Equipment Register">
      <EquipmentRegister
        initialEntries={(data as EquipmentRegisterEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialSites={(sites as EquipmentSiteOption[] | null) ?? []}
        statusOptions={statusOptions}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </HrPayrollShell>
  );
}
