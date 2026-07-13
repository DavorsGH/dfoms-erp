import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { mapApproverRows } from "../../approver-utils";
import type { Approver, Employee } from "../../lookup-types";
import Approvers from "../approvers";

export default async function ApproversPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: approvers, error: approversError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase
      .from("approvers")
      .select("employee_id, employees(full_name)")
      .order("employee_id", { ascending: true }),
    supabase
      .from("employees")
      .select("employee_id, full_name")
      .order("full_name", { ascending: true }),
  ]);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">Approvers</h2>
      <Approvers
        initialApprovers={mapApproverRows(approvers ?? []) as Approver[]}
        initialEmployees={(employees as Employee[] | null) ?? []}
        fetchError={approversError?.message ?? employeesError?.message ?? null}
      />
    </>
  );
}
