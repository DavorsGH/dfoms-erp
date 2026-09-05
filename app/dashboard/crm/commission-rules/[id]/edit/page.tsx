import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
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
  COMMISSION_RULE_LIST_SELECT,
  commissionRuleToFormState,
  normalizeCommissionRuleRow,
  type CommissionRuleListRow,
} from "@/utils/commission-types";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../../../hr-payroll/employee-utils";
import CrmShell from "../../../crm-shell";
import CommissionRuleForm from "../../commission-rule-form";

type EditCommissionRulePageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditCommissionRulePage({
  params,
}: EditCommissionRulePageProps) {
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

  const [{ data: rule, error: ruleError }, { data: employees, error: employeesError }] =
    await Promise.all([
      applyBusinessUnitScope(
        supabase
          .from("commission_rules")
          .select(COMMISSION_RULE_LIST_SELECT)
          .eq("id", id),
        buScope,
      ).maybeSingle(),
      applyBusinessUnitScope(
        supabase
          .from("employees")
          .select(`${HR_EMPLOYEE_SELECT}, position`),
        buScope,
      ).order("full_name"),
    ]);

  if (!rule) {
    notFound();
  }

  const normalized = normalizeCommissionRuleRow(rule as CommissionRuleListRow);
  const positionRows = ((employees as Array<{ position?: string | null }> | null) ?? [])
    .map((row) => row.position?.trim())
    .filter((value): value is string => Boolean(value));

  return (
    <CrmShell sectionTitle="Commission Rules">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">Edit Commission Rule</h3>
        <Link
          href="/dashboard/crm/commission-rules"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <CommissionRuleForm
        mode="edit"
        ruleId={id}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        positionOptions={[...new Set(positionRows)].sort()}
        initialForm={commissionRuleToFormState(normalized)}
        fetchError={
          (ruleError as { message?: string } | null)?.message ??
          (employeesError as { message?: string } | null)?.message ??
          null
        }
      />
    </CrmShell>
  );
}
