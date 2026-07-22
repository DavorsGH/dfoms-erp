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
  COMPLAINT_REGISTER_SELECT,
  getComplaintClientName,
  getComplaintSiteName,
  normalizeComplaintRegisterEntry,
  type ComplaintRegisterEntry,
} from "./complaint-register-utils";
import {
  COMPLAINT_PRIORITY_OPTIONS,
  COMPLAINT_STATUS_OPTIONS,
  DEFAULT_COMPLAINT_STATUS,
  nullableText,
  truncateText,
} from "./operations-register-utils";
import { allocateComplaintNo } from "./operations-ids-api";
import type { SiteEntry } from "./sites-utils";

type ComplaintRegisterProps = {
  initialEntries: ComplaintRegisterEntry[];
  initialClients: ClientEntry[];
  initialSites: SiteEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  complaint_no: "",
  date_received: "",
  client_id: "",
  site_id: "",
  area: "",
  complaint_details: "",
  priority: "",
  assigned_supervisor: "",
  action_taken: "",
  status: DEFAULT_COMPLAINT_STATUS,
  resolution_date: "",
  customer_satisfaction: "",
  repeat_complaint: false,
  notes: "",
};

export default function ComplaintRegister({
  initialEntries,
  initialClients,
  initialSites,
  initialEmployees,
  fetchError,
}: ComplaintRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeComplaintRegisterEntry),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterClient, setFilterClient] = useState("");
  const [filterPriority, setFilterPriority] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    setEntries(initialEntries.map(normalizeComplaintRegisterEntry));
  }, [initialEntries]);

  const formSiteOptions = useMemo(() => {
    if (!form.client_id) {
      return [];
    }

    return initialSites.filter((site) => site.client_id === form.client_id);
  }, [form.client_id, initialSites]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (filterClient && (entry.client_id ?? "") !== filterClient) {
        return false;
      }

      if (filterPriority && (entry.priority ?? "") !== filterPriority) {
        return false;
      }

      if (filterStatus && (entry.status ?? "") !== filterStatus) {
        return false;
      }

      return true;
    });
  }, [entries, filterClient, filterPriority, filterStatus]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("complaint_register")
      .select(COMPLAINT_REGISTER_SELECT)
      .order("date_received", { ascending: false })
      .order("complaint_no", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as ComplaintRegisterEntry[] | null) ?? []).map(
        normalizeComplaintRegisterEntry,
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      date_received: toDateInputValue(new Date().toISOString()),
      status: DEFAULT_COMPLAINT_STATUS,
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: ComplaintRegisterEntry) {
    setEditingId(entry.complaint_no);
    setForm({
      complaint_no: entry.complaint_no,
      date_received: toDateInputValue(entry.date_received),
      client_id: entry.client_id ?? "",
      site_id: entry.site_id ?? "",
      area: entry.area ?? "",
      complaint_details: entry.complaint_details ?? "",
      priority: entry.priority ?? "",
      assigned_supervisor: entry.assigned_supervisor ?? "",
      action_taken: entry.action_taken ?? "",
      status: entry.status ?? DEFAULT_COMPLAINT_STATUS,
      resolution_date: entry.resolution_date
        ? toDateInputValue(entry.resolution_date)
        : "",
      customer_satisfaction: entry.customer_satisfaction ?? "",
      repeat_complaint: Boolean(entry.repeat_complaint),
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

      if (field === "client_id" && value !== current.client_id) {
        next.site_id = "";
      }

      return next;
    });
  }

  async function handleDelete(complaintNo: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(complaintNo);
    setError(null);

    const { error: deleteError } = await supabase
      .from("complaint_register")
      .delete()
      .eq("complaint_no", complaintNo);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === complaintNo) {
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
      complaint_no: form.complaint_no.trim(),
      date_received: form.date_received,
      client_id: nullableText(form.client_id),
      site_id: nullableText(form.site_id),
      area: nullableText(form.area),
      complaint_details: nullableText(form.complaint_details),
      priority: nullableText(form.priority),
      assigned_supervisor: nullableText(form.assigned_supervisor),
      action_taken: nullableText(form.action_taken),
      status: nullableText(form.status) ?? DEFAULT_COMPLAINT_STATUS,
      resolution_date: nullableText(form.resolution_date),
      customer_satisfaction: nullableText(form.customer_satisfaction),
      repeat_complaint: form.repeat_complaint,
      notes: nullableText(form.notes),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("complaint_register")
        .update({
          date_received: payload.date_received,
          client_id: payload.client_id,
          site_id: payload.site_id,
          area: payload.area,
          complaint_details: payload.complaint_details,
          priority: payload.priority,
          assigned_supervisor: payload.assigned_supervisor,
          action_taken: payload.action_taken,
          status: payload.status,
          resolution_date: payload.resolution_date,
          customer_satisfaction: payload.customer_satisfaction,
          repeat_complaint: payload.repeat_complaint,
          notes: payload.notes,
        })
        .eq("complaint_no", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateComplaintNo(supabase);
      if (allocated.error || !allocated.complaintNo) {
        setError(allocated.error ?? "Unable to allocate complaint number.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("complaint_register")
        .insert({
          ...payload,
          complaint_no: allocated.complaintNo,
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Client
            </label>
            <select
              value={filterClient}
              onChange={(event) => setFilterClient(event.target.value)}
              className={inputClassName}
            >
              <option value="">All clients</option>
              {initialClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Priority
            </label>
            <select
              value={filterPriority}
              onChange={(event) => setFilterPriority(event.target.value)}
              className={inputClassName}
            >
              <option value="">All priorities</option>
              {COMPLAINT_PRIORITY_OPTIONS.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Status
            </label>
            <select
              value={filterStatus}
              onChange={(event) => setFilterStatus(event.target.value)}
              className={inputClassName}
            >
              <option value="">All statuses</option>
              {COMPLAINT_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Complaint"}
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
            {editingId ? "Edit Complaint" : "New Complaint"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Complaint No
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.complaint_no}
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date Received
                </label>
                <input
                  type="date"
                  required
                  value={form.date_received}
                  onChange={(event) =>
                    updateField("date_received", event.target.value)
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
                  {COMPLAINT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
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
                  Priority
                </label>
                <select
                  value={form.priority}
                  onChange={(event) => updateField("priority", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select priority</option>
                  {COMPLAINT_PRIORITY_OPTIONS.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Assigned Supervisor
                </label>
                <select
                  value={form.assigned_supervisor}
                  onChange={(event) =>
                    updateField("assigned_supervisor", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select supervisor</option>
                  {initialEmployees.map((employee) => (
                    <option key={employee.employee_id} value={employee.employee_id}>
                      {employee.staff_id} — {employee.full_name}
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
                  Resolution Date
                </label>
                <input
                  type="date"
                  value={form.resolution_date}
                  onChange={(event) =>
                    updateField("resolution_date", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Customer Satisfaction
                </label>
                <input
                  type="text"
                  value={form.customer_satisfaction}
                  onChange={(event) =>
                    updateField("customer_satisfaction", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.repeat_complaint}
                    onChange={(event) =>
                      updateField("repeat_complaint", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Repeat Complaint
                </label>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Complaint Details
                </label>
                <textarea
                  value={form.complaint_details}
                  onChange={(event) =>
                    updateField("complaint_details", event.target.value)
                  }
                  rows={3}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Action Taken
                </label>
                <textarea
                  value={form.action_taken}
                  onChange={(event) =>
                    updateField("action_taken", event.target.value)
                  }
                  rows={2}
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
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Complaint"}
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
              <th className={scrollableTableThClassName}>Date Received</th>
              <th className={scrollableTableThClassName}>Client</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Complaint Details</th>
              <th className={scrollableTableThClassName}>Priority</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Repeat Complaint</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No complaints match the selected filters.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry, index) => (
                <tr
                  key={entry.complaint_no}
                  className={
                    entry.repeat_complaint
                      ? "bg-amber-50 text-slate-700"
                      : getStripedRowClassName(index)
                  }
                >
                  <td className="px-4 py-3">{formatDate(entry.date_received)}</td>
                  <td className="px-4 py-3">{getComplaintClientName(entry)}</td>
                  <td className="px-4 py-3">{getComplaintSiteName(entry)}</td>
                  <td className="px-4 py-3">
                    {truncateText(entry.complaint_details)}
                  </td>
                  <td className="px-4 py-3">{entry.priority ?? "—"}</td>
                  <td className="px-4 py-3">{entry.status ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.repeat_complaint ? (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-800">
                        <span aria-hidden>⚠</span> Yes
                      </span>
                    ) : (
                      "No"
                    )}
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.complaint_no)}
                    deleting={deletingId === entry.complaint_no}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
