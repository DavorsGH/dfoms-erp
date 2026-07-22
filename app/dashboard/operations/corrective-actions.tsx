"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  getEmployeeDisplayName,
  type HrEmployee,
} from "../hr-payroll/employee-utils";
import { formatDate, inputClassName } from "../hr-payroll/hr-register-utils";
import type { ClientEntry } from "./clients-utils";
import {
  CORRECTIVE_ACTION_SELECT,
  getCorrectiveActionClientName,
  isCorrectiveActionOverdue,
  normalizeCorrectiveActionEntry,
  type CorrectiveActionEntry,
  type FailedIssueLookupOption,
  type WorkOrderLookupOption,
} from "./corrective-actions-utils";
import {
  CORRECTIVE_ACTION_STATUS_OPTIONS,
  DEFAULT_CORRECTIVE_ACTION_STATUS,
  nullableText,
  truncateText,
} from "./operations-register-utils";
import { allocateCorrectiveActionNo } from "./operations-ids-api";

type CorrectiveActionsProps = {
  initialEntries: CorrectiveActionEntry[];
  initialClients: ClientEntry[];
  initialWorkOrders: WorkOrderLookupOption[];
  initialFailedIssues: FailedIssueLookupOption[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  action_no: "",
  related_work_order: "",
  related_issue_no: "",
  date_raised: "",
  client_id: "",
  issue_description: "",
  responsible_person: "",
  target_date: "",
  status: DEFAULT_CORRECTIVE_ACTION_STATUS,
  completion_date: "",
  evidence_submitted: false,
  management_approval: false,
  notes: "",
};

export default function CorrectiveActions({
  initialEntries,
  initialClients,
  initialWorkOrders,
  initialFailedIssues,
  initialEmployees,
  fetchError,
}: CorrectiveActionsProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeCorrectiveActionEntry),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setEntries(initialEntries.map(normalizeCorrectiveActionEntry));
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("corrective_actions")
      .select(CORRECTIVE_ACTION_SELECT)
      .order("date_raised", { ascending: false })
      .order("action_no", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as CorrectiveActionEntry[] | null) ?? []).map(
        normalizeCorrectiveActionEntry,
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      date_raised: toDateInputValue(new Date().toISOString()),
      status: DEFAULT_CORRECTIVE_ACTION_STATUS,
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: CorrectiveActionEntry) {
    setEditingId(entry.action_no);
    setForm({
      action_no: entry.action_no,
      related_work_order: entry.related_work_order ?? "",
      related_issue_no: entry.related_issue_no ?? "",
      date_raised: toDateInputValue(entry.date_raised),
      client_id: entry.client_id ?? "",
      issue_description: entry.issue_description ?? "",
      responsible_person: entry.responsible_person ?? "",
      target_date: entry.target_date ? toDateInputValue(entry.target_date) : "",
      status: entry.status ?? DEFAULT_CORRECTIVE_ACTION_STATUS,
      completion_date: entry.completion_date
        ? toDateInputValue(entry.completion_date)
        : "",
      evidence_submitted: Boolean(entry.evidence_submitted),
      management_approval: Boolean(entry.management_approval),
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  function updateField<K extends keyof typeof emptyForm>(
    field: K,
    value: (typeof emptyForm)[K],
  ) {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "related_issue_no" && value) {
        const issue = initialFailedIssues.find(
          (entry) => entry.issue_no === value,
        );
        if (issue?.problem_description && !next.issue_description) {
          next.issue_description = issue.problem_description;
        }
      }

      return next;
    });
  }

  async function handleDelete(actionNo: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(actionNo);
    setError(null);

    const { error: deleteError } = await supabase
      .from("corrective_actions")
      .delete()
      .eq("action_no", actionNo);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === actionNo) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      action_no: form.action_no.trim(),
      related_work_order: nullableText(form.related_work_order),
      related_issue_no: nullableText(form.related_issue_no),
      date_raised: form.date_raised,
      client_id: nullableText(form.client_id),
      issue_description: nullableText(form.issue_description),
      responsible_person: nullableText(form.responsible_person),
      target_date: nullableText(form.target_date),
      status: nullableText(form.status) ?? DEFAULT_CORRECTIVE_ACTION_STATUS,
      completion_date: nullableText(form.completion_date),
      evidence_submitted: form.evidence_submitted,
      management_approval: form.management_approval,
      notes: nullableText(form.notes),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("corrective_actions")
        .update({
          related_work_order: payload.related_work_order,
          related_issue_no: payload.related_issue_no,
          date_raised: payload.date_raised,
          client_id: payload.client_id,
          issue_description: payload.issue_description,
          responsible_person: payload.responsible_person,
          target_date: payload.target_date,
          status: payload.status,
          completion_date: payload.completion_date,
          evidence_submitted: payload.evidence_submitted,
          management_approval: payload.management_approval,
          notes: payload.notes,
        })
        .eq("action_no", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateCorrectiveActionNo(supabase);
      if (allocated.error || !allocated.actionNo) {
        setError(allocated.error ?? "Unable to allocate corrective action number.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("corrective_actions")
        .insert({
          ...payload,
          action_no: allocated.actionNo,
        });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Corrective Action"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Corrective Action" : "New Corrective Action"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Action No
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.action_no}
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date Raised
                </label>
                <input
                  type="date"
                  required
                  value={form.date_raised}
                  onChange={(event) =>
                    updateField("date_raised", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <select
                  value={form.status}
                  onChange={(event) => updateField("status", event.target.value)}
                  className={inputClassName}
                >
                  {CORRECTIVE_ACTION_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Related Work Order
                </label>
                <select
                  value={form.related_work_order}
                  onChange={(event) =>
                    updateField("related_work_order", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Optional</option>
                  {initialWorkOrders.map((workOrder) => (
                    <option
                      key={workOrder.work_order_no}
                      value={workOrder.work_order_no}
                    >
                      {workOrder.work_order_no}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Related Issue No
                </label>
                <select
                  value={form.related_issue_no}
                  onChange={(event) =>
                    updateField("related_issue_no", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Optional</option>
                  {initialFailedIssues.map((issue) => (
                    <option key={issue.issue_no} value={issue.issue_no}>
                      {issue.issue_no}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Client
                </label>
                <select
                  value={form.client_id}
                  onChange={(event) => updateField("client_id", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select client</option>
                  {initialClients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.client_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Responsible Person
                </label>
                <select
                  value={form.responsible_person}
                  onChange={(event) =>
                    updateField("responsible_person", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select employee</option>
                  {initialEmployees.map((employee) => (
                    <option key={employee.employee_id} value={employee.employee_id}>
                      {employee.staff_id} — {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Target Date
                </label>
                <input
                  type="date"
                  value={form.target_date}
                  onChange={(event) =>
                    updateField("target_date", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Completion Date
                </label>
                <input
                  type="date"
                  value={form.completion_date}
                  onChange={(event) =>
                    updateField("completion_date", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div className="flex items-end gap-6">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.evidence_submitted}
                    onChange={(event) =>
                      updateField("evidence_submitted", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Evidence Submitted
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.management_approval}
                    onChange={(event) =>
                      updateField("management_approval", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Management Approval
                </label>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Issue Description
                </label>
                <textarea
                  value={form.issue_description}
                  onChange={(event) =>
                    updateField("issue_description", event.target.value)
                  }
                  rows={3}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  rows={2}
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Action"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date Raised</th>
              <th className={scrollableTableThClassName}>Client</th>
              <th className={scrollableTableThClassName}>Issue Description</th>
              <th className={scrollableTableThClassName}>Responsible Person</th>
              <th className={scrollableTableThClassName}>Target Date</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No corrective actions recorded yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const overdue = isCorrectiveActionOverdue(entry);
                const rowClassName = overdue
                  ? "bg-red-50 text-slate-700"
                  : getStripedRowClassName(index);

                return (
                  <tr key={entry.action_no} className={rowClassName}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        {overdue ? (
                          <span aria-hidden className="text-red-600" title="Overdue">
                            ⚠
                          </span>
                        ) : null}
                        {formatDate(entry.date_raised)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {getCorrectiveActionClientName(entry)}
                    </td>
                    <td className="px-4 py-3">
                      {truncateText(entry.issue_description)}
                    </td>
                    <td className="px-4 py-3">
                      {entry.responsible_person
                        ? getEmployeeDisplayName(
                            initialEmployees,
                            entry.responsible_person,
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {entry.target_date ? formatDate(entry.target_date) : "—"}
                    </td>
                    <td className="px-4 py-3">{entry.status ?? "—"}</td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.action_no)}
                      deleting={deletingId === entry.action_no}
                    />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
