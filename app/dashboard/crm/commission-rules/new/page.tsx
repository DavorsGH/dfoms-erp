import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
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
import CrmShell from "../../crm-shell";
import CommissionRuleForm from "../commission-rule-form";

export default async function NewCommissionRulePage() {
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

  const { data: employees, error } = await applyBusinessUnitScope(
    supabase
      .from("employees")
      .select(`${HR_EMPLOYEE_SELECT}, position`),
    buScope,
  ).order("full_name");

  const employeeRows = filterActiveEmployees((employees as HrEmployee[] | null) ?? []);
  const positionRows = ((employees as Array<{ position?: string | null }> | null) ?? [])
    .map((row) => row.position?.trim())
    .filter((value): value is string => Boolean(value));

  return (
    <CrmShell sectionTitle="Commission Rules">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">New Commission Rule</h3>
        <Link
          href="/dashboard/crm/commission-rules"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <CommissionRuleForm
        mode="create"
        initialEmployees={employeeRows}
        positionOptions={[...new Set(positionRows)].sort()}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
