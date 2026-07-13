import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import EmployeesDirectory from "./employees-directory";
import type { EmployeeRecord } from "./employee-record-utils";
import { EMPLOYEE_SELECT } from "./employee-record-utils";
import {
  buildDepartmentNameMap,
  buildProjectNameMap,
  loadEmployeeLookups,
  loadEmployeePayConfig,
} from "./lookup-utils";

export default async function EmployeesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, lookups, payConfig] = await Promise.all([
    supabase.from("employees").select(EMPLOYEE_SELECT).order("staff_id", { ascending: true }),
    loadEmployeeLookups(supabase),
    loadEmployeePayConfig(supabase),
  ]);

  return (
    <EmployeesDirectory
      initialEmployees={(data as EmployeeRecord[] | null) ?? []}
      initialLookups={lookups}
      initialPayConfig={payConfig}
      departmentNameMap={buildDepartmentNameMap(lookups.departments)}
      projectNameMap={buildProjectNameMap(lookups.projects)}
      fetchError={error?.message ?? null}
    />
  );
}
