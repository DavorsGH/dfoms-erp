"use client";

import { useEffect, useMemo, useState } from "react";
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
  FAILED_INSPECTION_SELECT,
  getFailedInspectionClientName,
  getFailedInspectionSiteName,
  isFailedInspectionOverdue,
  normalizeFailedInspectionEntry,
  type FailedInspectionEntry,
  type InspectionChecklistLookup,
} from "./failed-inspections-utils";
import {
  nullableText,
  SEVERITY_OPTIONS,
  truncateText,
} from "./operations-register-utils";
import { allocateFailedInspectionIssueNo } from "./operations-ids-api";
import type { SiteEntry } from "./sites-utils";

type FailedInspectionsProps = {
  initialEntries: FailedInspectionEntry[];
  initialClients: ClientEntry[];
  initialSites: SiteEntry[];
  initialChecklists: InspectionChecklistLookup[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  issue_no: "",
  checklist_id: "",
  date_identified: "",
  client_id: "",
  site_id: "",
  area: "",
  problem_description: "",
  severity: "",
  assigned_person: "",
  target_date: "",
  completed: false,
  date_closed: "",
};

export default function FailedInspections({
  initialEntries,
  initialClients,
  initialSites,
  initialChecklists,
  initialEmployees,
  fetchError,
}: FailedInspectionsProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeFailedInspectionEntry),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setEntries(initialEntries.map(normalizeFailedInspectionEntry));
  }, [initialEntries]);

  const formSiteOptions = useMemo(() => {
    if (!form.client_id) {
      return [];
    }

    return initialSites.filter((site) => site.client_id === form.client_id);
  }, [form.client_id, initialSites]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("failed_inspections")
      .select(FAILED_INSPECTION_SELECT)
      .order("date_identified", { ascending: false })
      .order("issue_no", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as FailedInspectionEntry[] | null) ?? []).map(
        normalizeFailedInspectionEntry,
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      date_identified: toDateInputValue(new Date().toISOString()),
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: FailedInspectionEntry) {
    setEditingId(entry.issue_no);
    setForm({
      issue_no: entry.issue_no,
      checklist_id: entry.checklist_id ?? "",
      date_identified: toDateInputValue(entry.date_identified),
      client_id: entry.client_id ?? "",
      site_id: entry.site_id ?? "",
      area: entry.area ?? "",
      problem_description: entry.problem_description ?? "",
      severity: entry.severity ?? "",
      assigned_person: entry.assigned_person ?? "",
      target_date: entry.target_date ? toDateInputValue(entry.target_date) : "",
      completed: Boolean(entry.completed),
      date_closed: entry.date_closed ? toDateInputValue(entry.date_closed) : "",
    });
    setShowForm(true);
  }

  function updateField<K extends keyof typeof emptyForm>(
    field: K,
    value: (typeof emptyForm)[K],
  ) {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "client_id" && value !== current.client_id) {
        next.site_id = "";
      }

      if (field === "checklist_id" && value) {
        const checklist = initialChecklists.find(
          (entry) => entry.checklist_id === value,
        );
        if (checklist) {
          next.client_id = checklist.client_id ?? "";
          next.site_id = checklist.site_id ?? "";
        }
      }

      return next;
    });
  }

  async function handleDelete(issueNo: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(issueNo);
    setError(null);

    const { error: deleteError } = await supabase
      .from("failed_inspections")
      .delete()
      .eq("issue_no", issueNo);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === issueNo) {
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
      issue_no: form.issue_no.trim(),
      checklist_id: nullableText(form.checklist_id),
      date_identified: form.date_identified,
      client_id: nullableText(form.client_id),
      site_id: nullableText(form.site_id),
      area: nullableText(form.area),
      problem_description: nullableText(form.problem_description),
      severity: nullableText(form.severity),
      assigned_person: nullableText(form.assigned_person),
      target_date: nullableText(form.target_date),
      completed: form.completed,
      date_closed: nullableText(form.date_closed),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("failed_inspections")
        .update({
          checklist_id: payload.checklist_id,
          date_identified: payload.date_identified,
          client_id: payload.client_id,
          site_id: payload.site_id,
          area: payload.area,
          problem_description: payload.problem_description,
          severity: payload.severity,
          assigned_person: payload.assigned_person,
          target_date: payload.target_date,
          completed: payload.completed,
          date_closed: payload.date_closed,
        })
        .eq("issue_no", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateFailedInspectionIssueNo(supabase);
      if (allocated.error || !allocated.issueNo) {
        setError(allocated.error ?? "Unable to allocate issue number.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("failed_inspections")
        .insert({
          ...payload,
          issue_no: allocated.issueNo,
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
          {showForm ? "Cancel" : "Add Failed Inspection"}
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
            {editingId ? "Edit Failed Inspection" : "New Failed Inspection"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Issue No
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.issue_no}
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Checklist ID
                </label>
                <select
                  value={form.checklist_id}
                  onChange={(event) =>
                    updateField("checklist_id", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select checklist</option>
                  {initialChecklists.map((checklist) => (
                    <option key={checklist.checklist_id} value={checklist.checklist_id}>
                      {checklist.checklist_id}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date Identified
                </label>
                <input
                  type="date"
                  required
                  value={form.date_identified}
                  onChange={(event) =>
                    updateField("date_identified", event.target.value)
                  }
                  className={inputClassName}
                />
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
                  Site
                </label>
                <select
                  value={form.site_id}
                  onChange={(event) => updateField("site_id", event.target.value)}
                  disabled={!form.client_id}
                  className={inputClassName}
                >
                  <option value="">
                    {form.client_id ? "Select site" : "Select a client first"}
                  </option>
                  {formSiteOptions.map((site) => (
                    <option key={site.site_code} value={site.site_code}>
                      {site.site_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Area
                </label>
                <input
                  type="text"
                  value={form.area}
                  onChange={(event) => updateField("area", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Severity
                </label>
                <select
                  value={form.severity}
                  onChange={(event) => updateField("severity", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select severity</option>
                  {SEVERITY_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Assigned Person
                </label>
                <select
                  value={form.assigned_person}
                  onChange={(event) =>
                    updateField("assigned_person", event.target.value)
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
                  Date Closed
                </label>
                <input
                  type="date"
                  value={form.date_closed}
                  onChange={(event) =>
                    updateField("date_closed", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.completed}
                    onChange={(event) =>
                      updateField("completed", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Completed
                </label>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Problem Description
                </label>
                <textarea
                  value={form.problem_description}
                  onChange={(event) =>
                    updateField("problem_description", event.target.value)
                  }
                  rows={3}
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
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Issue"}
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
              <th className={scrollableTableThClassName}>Date Identified</th>
              <th className={scrollableTableThClassName}>Client</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Problem Description</th>
              <th className={scrollableTableThClassName}>Severity</th>
              <th className={scrollableTableThClassName}>Assigned Person</th>
              <th className={scrollableTableThClassName}>Target Date</th>
              <th className={scrollableTableThClassName}>Completed</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No failed inspections recorded yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const overdue = isFailedInspectionOverdue(entry);
                const rowClassName = overdue
                  ? "bg-red-50 text-slate-700"
                  : getStripedRowClassName(index);

                return (
                  <tr key={entry.issue_no} className={rowClassName}>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        {overdue ? (
                          <span aria-hidden className="text-red-600" title="Overdue">
                            ⚠
                          </span>
                        ) : null}
                        {formatDate(entry.date_identified)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {getFailedInspectionClientName(entry)}
                    </td>
                    <td className="px-4 py-3">{getFailedInspectionSiteName(entry)}</td>
                    <td className="px-4 py-3">
                      {truncateText(entry.problem_description)}
                    </td>
                    <td className="px-4 py-3">{entry.severity ?? "—"}</td>
                    <td className="px-4 py-3">
                      {entry.assigned_person
                        ? getEmployeeDisplayName(
                            initialEmployees,
                            entry.assigned_person,
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {entry.target_date ? formatDate(entry.target_date) : "—"}
                    </td>
                    <td className="px-4 py-3">{entry.completed ? "Yes" : "No"}</td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.issue_no)}
                      deleting={deletingId === entry.issue_no}
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
