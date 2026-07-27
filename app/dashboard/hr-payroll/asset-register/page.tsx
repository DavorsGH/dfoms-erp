import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import AssetRegister from "../asset-register";
import {
  ASSET_REGISTER_SELECT,
  type AssetRegisterEntry,
} from "../asset-register-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../employee-utils";
import HrPayrollShell from "../hr-payroll-shell";

export default async function AssetRegisterPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("asset_register")
        .select(ASSET_REGISTER_SELECT)
        .order("asset_id", { ascending: true }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError = error?.message ?? employeesError?.message ?? null;

  return (
    <HrPayrollShell sectionTitle="Staff Kit Register">
      <AssetRegister
        initialEntries={(data as AssetRegisterEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
