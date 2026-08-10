import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import { canAccessOperationsSection } from "@/utils/rbac-access";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { isCrmCustomerListOnlyRole } from "@/app/dashboard/user-account-role-utils";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import CrmShell from "../crm-shell";
import Customers from "./customers";
import type { CustomerEntry } from "./customers-utils";

export default async function CustomersPage() {
  const role = (await getCurrentUserRole()) as AppRole | null;
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .order("client_name", { ascending: true }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  const fetchError = error?.message ?? employeesError?.message ?? null;
  const customerListOnly = isCrmCustomerListOnlyRole(role);

  return (
    <CrmShell sectionTitle="Customer List" customerListOnly={customerListOnly}>
      <Customers
        initialCustomers={(data as CustomerEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        showOperationsColumns={canAccessOperationsSection(role)}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
