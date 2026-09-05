import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
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
  SALES_TARGET_LIST_SELECT,
  normalizeSalesTargetRow,
  salesTargetToFormState,
  type SalesTargetListRow,
} from "@/utils/sales-targets-types";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../../../hr-payroll/employee-utils";
import CrmShell from "../../../crm-shell";
import SalesTargetForm from "../../sales-target-form";

type EditSalesTargetPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditSalesTargetPage({
  params,
}: EditSalesTargetPageProps) {
  const { id } = await params;
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

  const [{ data: target, error: targetError }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("sales_targets")
        .select(SALES_TARGET_LIST_SELECT)
        .eq("id", id)
        .maybeSingle(),
      applyBusinessUnitScope(
        supabase.from("employees").select(HR_EMPLOYEE_SELECT),
        buScope,
      ).order("full_name"),
    ]);

  if (!target) {
    notFound();
  }

  const normalized = normalizeSalesTargetRow(target as SalesTargetListRow);
  const fetchError =
    (targetError as { message?: string } | null)?.message ??
    (employeesError as { message?: string } | null)?.message ??
    null;

  return (
    <CrmShell sectionTitle="Sales Targets">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">Edit Sales Target</h3>
        <Link
          href="/dashboard/crm/sales-targets"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <SalesTargetForm
        mode="edit"
        targetId={id}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialForm={salesTargetToFormState(normalized)}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
