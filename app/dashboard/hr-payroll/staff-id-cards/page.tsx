import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  buildDepartmentNameMap,
  loadEmployeeLookups,
} from "../../employees/lookup-utils";
import HrPayrollShell from "../hr-payroll-shell";
import StaffIdCards from "../staff-id-cards";
import {
  STAFF_ID_CARD_EMPLOYEE_SELECT,
  type StaffIdCardEmployee,
} from "../staff-id-cards-utils";

export default async function StaffIdCardsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, lookups] = await Promise.all([
    supabase
      .from("employees")
      .select(STAFF_ID_CARD_EMPLOYEE_SELECT)
      .order("staff_id", { ascending: true }),
    loadEmployeeLookups(supabase),
  ]);

  const departmentNameMap = buildDepartmentNameMap(lookups.departments);

  return (
    <HrPayrollShell sectionTitle="Staff ID Cards">
      <StaffIdCards
        initialEmployees={(data as StaffIdCardEmployee[] | null) ?? []}
        positions={lookups.positions}
        departmentNameMap={departmentNameMap}
        fetchError={error?.message ?? null}
      />
    </HrPayrollShell>
  );
}
