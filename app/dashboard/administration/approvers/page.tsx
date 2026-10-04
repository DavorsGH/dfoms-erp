import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { mapApproverRows } from "../../approver-utils";
import type { Approver, Employee } from "../../lookup-types";
import Approvers from "../approvers";

export default async function ApproversPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Approvers</h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Approvers.
        </p>
      </>
    );
  }

  const [
    { data: approvers, error: approversError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .eq("tenant_id", tenantId)
      .order("employee_id", { ascending: true }),
    supabase
      .from("employees")
      .select("employee_id, full_name")
      .eq("tenant_id", tenantId)
      .order("full_name", { ascending: true }),
  ]);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Approvers</h2>
      <Approvers
        tenantId={tenantId}
        initialApprovers={mapApproverRows(approvers ?? []) as Approver[]}
        initialEmployees={(employees as Employee[] | null) ?? []}
        fetchError={approversError?.message ?? employeesError?.message ?? null}
      />
    </>
  );
}
