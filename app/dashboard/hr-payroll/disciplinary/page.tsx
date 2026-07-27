import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import DisciplinaryRegister from "../disciplinary-register";
import {
  DISCIPLINARY_SELECT,
  type DisciplinaryRecordEntry,
} from "../disciplinary-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function DisciplinaryPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("disciplinary_records")
        .select(DISCIPLINARY_SELECT)
        .order("incident_date", { ascending: false }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError = error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Disciplinary Records">
      <DisciplinaryRegister
        initialEntries={(data as DisciplinaryRecordEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
