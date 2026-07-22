"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { Approver, Employee } from "../lookup-types";
import { mapApproverRows } from "../approver-utils";

type ApproversProps = {
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
  initialApprovers,
  initialEmployees,
  fetchError,
}: ApproversProps) {
  const supabase = createClient();
  const [approvers, setApprovers] = useState(initialApprovers);
  const [employees, setEmployees] = useState(initialEmployees);
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);

  async function refreshApprovers() {
    const { data, error: refreshError } = await supabase
      .from("approvers")
      .select("employee_id, employees!approvers_employee_id_fkey(full_name)")
      .order("employee_id", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setApprovers(mapApproverRows((data as ApproverRow[] | null) ?? []));
    setError(null);
  }

  async function refreshEmployees() {
    const { data, error: refreshError } = await supabase
      .from("employees")
      .select("employee_id, full_name")
      .order("full_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEmployees(data ?? []);
    setError(null);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: insertError } = await supabase
      .from("approvers")
      .insert({ employee_id: employeeId });

    if (insertError) {
      setError(insertError.message);
      setLoading(false);
      return;
    }

    setEmployeeId("");
    await Promise.all([refreshApprovers(), refreshEmployees()]);
    setLoading(false);
  }

  async function handleDelete(approverEmployeeId: string) {
    setDeletingId(approverEmployeeId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("approvers")
      .delete()
      .eq("employee_id", approverEmployeeId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    await Promise.all([refreshApprovers(), refreshEmployees()]);
    setDeletingId(null);
  }

  const availableEmployees = employees.filter(
    (employee) =>
      !approvers.some((approver) => approver.employee_id === employee.employee_id),
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">Approvers</h2>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

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
