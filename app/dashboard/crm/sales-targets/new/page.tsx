import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserEmployeeId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../../hr-payroll/employee-utils";
import { emptySalesTargetForm } from "@/utils/sales-targets-types";
import CrmShell from "../../crm-shell";
import SalesTargetForm from "../sales-target-form";

export default async function NewSalesTargetPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [{ data: employees, error }, defaultEmployeeId] = await Promise.all([
    applyBusinessUnitScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      buScope,
    ).order("full_name"),
    getCurrentUserEmployeeId(),
  ]);

  return (
    <CrmShell sectionTitle="Sales Targets">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">New Sales Target</h3>
        <Link
          href="/dashboard/crm/sales-targets"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <SalesTargetForm
        mode="create"
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialForm={emptySalesTargetForm(defaultEmployeeId ?? "")}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
