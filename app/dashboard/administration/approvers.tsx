"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
} from "@/utils/tenant-scoped-supabase";
import {
  FINANCE_APPROVER_INACTIVE_BADGE,
  buildActiveStaffChoices,
  type ActiveStaffAccount,
  type ActiveStaffChoice,
  type ActiveStaffEmployee,
} from "@/lib/active-staff-options";
import {
  FINANCE_APPROVER_ACCOUNT_SELECT,
  FINANCE_APPROVER_SELECT,
  buildFinanceApproverFormLookups,
} from "@/lib/finance-approver-lookups";
import type { Approver } from "../lookup-types";
import { useLookupSettingsFeedback } from "./lookup-settings-feedback";

type ApproversProps = {
  tenantId: string;
  initialApprovers: Approver[];
  pickerChoices: ActiveStaffChoice[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function Approvers({
  tenantId,
  initialApprovers,
  pickerChoices: initialPickerChoices,
  fetchError,
}: ApproversProps) {
  const supabase = createClient();
  const { showActionError, showActionSuccess } =
    useLookupSettingsFeedback(fetchError);
  const [approvers, setApprovers] = useState(initialApprovers);
  const [pickerChoices, setPickerChoices] = useState(initialPickerChoices);
  const [employeeId, setEmployeeId] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function refresh() {
    const [
      { data: approverRows, error: refreshApproversError },
      { data: employees, error: refreshEmployeesError },
      { data: accounts, error: refreshAccountsError },
    ] = await Promise.all([
      supabase
        .from("approvers")
        .select(FINANCE_APPROVER_SELECT)
        .eq("tenant_id", tenantId)
        .order("employee_id", { ascending: true }),
      supabase
        .from("employees")
        .select("employee_id, staff_id, full_name, employment_status")
        .eq("tenant_id", tenantId)
        .eq("employment_status", "Active")
        .order("full_name", { ascending: true }),
      supabase
        .from("user_accounts")
        .select(FINANCE_APPROVER_ACCOUNT_SELECT)
        .eq("tenant_id", tenantId)
        .eq("is_active", true),
    ]);

    const refreshError =
      refreshApproversError?.message ??
      refreshEmployeesError?.message ??
      refreshAccountsError?.message ??
      null;
    if (refreshError) {
      showActionError(refreshError);
      return;
    }

    const accountRows = (accounts as ActiveStaffAccount[] | null) ?? [];
    const { allApprovers } = buildFinanceApproverFormLookups(
      approverRows ?? [],
      accountRows,
    );
    setApprovers(allApprovers);
    setPickerChoices(
      buildActiveStaffChoices(
        (employees as ActiveStaffEmployee[] | null) ?? [],
        accountRows,
      ),
    );
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
    await refresh();
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

    await refresh();
    setDeletingId(null);
    showActionSuccess("Approver removed.");
  }

  const availableChoices = useMemo(
    () =>
      pickerChoices.filter(
        (choice) =>
          !approvers.some(
            (approver) => approver.employee_id === choice.employeeId,
          ),
      ),
    [approvers, pickerChoices],
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">Approvers</h2>
      <p className="mb-4 text-sm text-slate-600">
        Only active staff with a login can be added. Approvals use these people;
        inactive entries stay listed so you can replace them.
      </p>

      <form onSubmit={handleAdd} className="mb-6 flex flex-col gap-3 sm:flex-row">
        <select
          required
          value={employeeId}
          onChange={(e) => setEmployeeId(e.target.value)}
          className={inputClassName}
        >
          <option value="">Select employee</option>
          {availableChoices.map((choice) => (
            <option key={choice.key} value={choice.employeeId}>
              {choice.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || availableChoices.length === 0}
          className="shrink-0 rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Adding…" : "Add"}
        </button>
      </form>

      {approvers.length === 0 ? (
        <p className="text-sm text-slate-500">No approvers yet.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {approvers.map((approver) => {
            const inactive = approver.isActiveApprover === false;
            const label =
              approver.staff_id?.trim()
                ? `${approver.full_name} (${approver.staff_id.trim()})`
                : approver.full_name;
            return (
              <li
                key={approver.employee_id}
                className="flex flex-col gap-2 px-4 py-3 text-sm text-slate-700 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span>{label}</span>
                  {inactive ? (
                    <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                      {FINANCE_APPROVER_INACTIVE_BADGE}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(approver.employee_id)}
                  disabled={deletingId === approver.employee_id}
                  className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deletingId === approver.employee_id ? "Deleting…" : "Delete"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
