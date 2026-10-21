"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
} from "@/utils/tenant-scoped-supabase";
import type { Approver, Employee } from "../lookup-types";
import { mapApproverRows } from "../approver-utils";
import { useLookupSettingsFeedback } from "./lookup-settings-feedback";

type ApproversProps = {
  tenantId: string;
  initialApprovers: Approver[];
  initialEmployees: Employee[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type ApproverRow = {
  employee_id: string;
  employees: { full_name: string } | { full_name: string }[] | null;
};

export default function Approvers({
  tenantId,
  initialApprovers,
  initialEmployees,
  fetchError,
}: ApproversProps) {
  const supabase = createClient();
  const { showActionError, showActionSuccess } =
    useLookupSettingsFeedback(fetchError);
  const [approvers, setApprovers] = useState(initialApprovers);
  const [employees, setEmployees] = useState(initialEmployees);
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function refreshApprovers() {
    const { data, error: refreshError } = await supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .order("employee_id", { ascending: true });

    if (refreshError) {
      showActionError(refreshError);
      return;
    }

    setApprovers(mapApproverRows((data as ApproverRow[] | null) ?? []));
  }

  async function refreshEmployees() {
    const { data, error: refreshError } = await supabase
      .from("employees")
      .select("employee_id, full_name")
      .order("full_name", { ascending: true });

    if (refreshError) {
      showActionError(refreshError);
      return;
    }

    setEmployees(data ?? []);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    const scopedTenantId = assertTenantIdForMutation(tenantId);
    const { error: insertError } = await supabase
      .from("approvers")
      .insert({ tenant_id: scopedTenantId, employee_id: employeeId });

    if (insertError) {
      setLoading(false);
      showActionError(insertError);
      return;
    }

    setEmployeeId("");
    await Promise.all([refreshApprovers(), refreshEmployees()]);
    setLoading(false);
    showActionSuccess("Approver added.");
  }

  async function handleDelete(approverEmployeeId: string) {
    setDeletingId(approverEmployeeId);

    const { error: deleteError } = await tenantScopedDelete(
      supabase,
      "approvers",
      assertTenantIdForMutation(tenantId),
      { employee_id: approverEmployeeId },
    );

    if (deleteError) {
      setDeletingId(null);
      showActionError("Unable to remove this approver. Try again.");
      return;
    }

    await Promise.all([refreshApprovers(), refreshEmployees()]);
    setDeletingId(null);
    showActionSuccess("Approver removed.");
  }

  const availableEmployees = employees.filter(
    (employee) =>
      !approvers.some((approver) => approver.employee_id === employee.employee_id),
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">Approvers</h2>

      <form onSubmit={handleAdd} className="mb-6 flex flex-col gap-3 sm:flex-row">
        <select
          required
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className={inputClassName}
        >
          <option value="">Select employee</option>
          {availableEmployees.map((employee) => (
            <option key={employee.employee_id} value={employee.employee_id}>
              {employee.full_name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || availableEmployees.length === 0}
          className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Adding…" : "Add"}
        </button>
      </form>

      {approvers.length === 0 ? (
        <p className="text-sm text-slate-500">No approvers yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {approvers.map((approver) => (
            <li
              key={approver.employee_id}
              className="flex items-center justify-between px-4 py-3 text-sm text-slate-700"
            >
              <span>{approver.full_name}</span>
              <button
                type="button"
                onClick={() => handleDelete(approver.employee_id)}
                disabled={deletingId === approver.employee_id}
                className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingId === approver.employee_id ? "Deleting…" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
