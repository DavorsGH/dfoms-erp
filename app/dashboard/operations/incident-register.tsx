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
import type { HrEmployee } from "../hr-payroll/employee-utils";
import { formatDate, inputClassName } from "../hr-payroll/hr-register-utils";
import type { ClientEntry } from "./clients-utils";
import {
  INCIDENT_REGISTER_SELECT,
  getIncidentClientName,
  getIncidentReporterName,
  getIncidentSiteName,
  normalizeIncidentRegisterEntry,
  type IncidentRegisterEntry,
} from "./incident-register-utils";
import {
  DEFAULT_INCIDENT_STATUS,
  INCIDENT_STATUS_OPTIONS,
  INCIDENT_TYPE_OPTIONS,
  SEVERITY_OPTIONS,
  nullableText,
  truncateText,
} from "./operations-register-utils";
import { allocateIncidentNo } from "./operations-ids-api";
import type { SiteEntry } from "./sites-utils";

type IncidentRegisterProps = {
  initialEntries: IncidentRegisterEntry[];
  initialClients: ClientEntry[];
  initialSites: SiteEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  incident_no: "",
  date: "",
  time: "",
  client_id: "",
  site_id: "",
  area: "",
  incident_type: "",
  description: "",
  severity: "",
  reported_by: "",
  action_taken: "",
  status: DEFAULT_INCIDENT_STATUS,
  date_resolved: "",
  escalated_to_mgmt: false,
  notes: "",
};

function toTimeInputValue(value: string | null | undefined): string {
  if (!value?.trim()) {
    return "";
  }
  return value.trim().slice(0, 5);
}

export default function IncidentRegister({
  initialEntries,
  initialClients,
  initialSites,
  initialEmployees,
  fetchError,
}: IncidentRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeIncidentRegisterEntry),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterClient, setFilterClient] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  useEffect(() => {
    setEntries(initialEntries.map(normalizeIncidentRegisterEntry));
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

      if (filterSeverity && (entry.severity ?? "") !== filterSeverity) {
        return false;
      }

      if (filterStatus && (entry.status ?? "") !== filterStatus) {
        return false;
      }

      return true;
    });
  }, [entries, filterClient, filterSeverity, filterStatus]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("incident_register")
      .select(INCIDENT_REGISTER_SELECT)
      .order("date", { ascending: false })
      .order("incident_no", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as IncidentRegisterEntry[] | null) ?? []).map(
        normalizeIncidentRegisterEntry,
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      date: toDateInputValue(new Date().toISOString()),
      status: DEFAULT_INCIDENT_STATUS,
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: IncidentRegisterEntry) {
    setEditingId(entry.incident_no);
    setForm({
      incident_no: entry.incident_no,
      date: toDateInputValue(entry.date),
      time: toTimeInputValue(entry.time),
      client_id: entry.client_id ?? "",
      site_id: entry.site_id ?? "",
      area: entry.area ?? "",
      incident_type: entry.incident_type ?? "",
      description: entry.description ?? "",
      severity: entry.severity ?? "",
      reported_by: entry.reported_by ?? "",
      action_taken: entry.action_taken ?? "",
      status: entry.status ?? DEFAULT_INCIDENT_STATUS,
      date_resolved: entry.date_resolved
        ? toDateInputValue(entry.date_resolved)
        : "",
      escalated_to_mgmt: Boolean(entry.escalated_to_mgmt),
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

  async function handleDelete(incidentNo: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(incidentNo);
    setError(null);

    const { error: deleteError } = await supabase
      .from("incident_register")
      .delete()
      .eq("incident_no", incidentNo);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === incidentNo) {
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
      incident_no: form.incident_no.trim(),
      date: form.date,
      time: nullableText(form.time),
      client_id: nullableText(form.client_id),
      site_id: nullableText(form.site_id),
      area: nullableText(form.area),
      incident_type: nullableText(form.incident_type),
      description: nullableText(form.description),
      severity: nullableText(form.severity),
      reported_by: nullableText(form.reported_by),
      action_taken: nullableText(form.action_taken),
      status: nullableText(form.status) ?? DEFAULT_INCIDENT_STATUS,
      date_resolved: nullableText(form.date_resolved),
      escalated_to_mgmt: form.escalated_to_mgmt,
      notes: nullableText(form.notes),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("incident_register")
        .update({
          date: payload.date,
          time: payload.time,
          client_id: payload.client_id,
          site_id: payload.site_id,
          area: payload.area,
          incident_type: payload.incident_type,
          description: payload.description,
          severity: payload.severity,
          reported_by: payload.reported_by,
          action_taken: payload.action_taken,
          status: payload.status,
          date_resolved: payload.date_resolved,
          escalated_to_mgmt: payload.escalated_to_mgmt,
          notes: payload.notes,
        })
        .eq("incident_no", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateIncidentNo(supabase);
      if (allocated.error || !allocated.incidentNo) {
        setError(allocated.error ?? "Unable to allocate incident number.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("incident_register")
        .insert({
          ...payload,
          incident_no: allocated.incidentNo,
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
              Filter by Customer
            </label>
            <select
              value={filterClient}
              onChange={(event) => setFilterClient(event.target.value)}
              className={inputClassName}
            >
              <option value="">All customers</option>
              {initialClients.map((client) => (
                <option key={client.client_id} value={client.client_id}>
                  {client.client_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Severity
            </label>
            <select
              value={filterSeverity}
              onChange={(event) => setFilterSeverity(event.target.value)}
              className={inputClassName}
            >
              <option value="">All severities</option>
              {SEVERITY_OPTIONS.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
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
              {INCIDENT_STATUS_OPTIONS.map((status) => (
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
          {showForm ? "Cancel" : "Add Incident"}
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
            {editingId ? "Edit Incident" : "New Incident"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Incident No
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.incident_no}
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(event) => updateField("date", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Time
                </label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(event) => updateField("time", event.target.value)}
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
                  {INCIDENT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Customer
                </label>
                <select
                  value={form.client_id}
                  onChange={(event) => updateField("client_id", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select customer</option>
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
                    {form.client_id ? "Select site" : "Select a customer first"}
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
                  Severity
                </label>
                <select
                  value={form.severity}
                  onChange={(event) => updateField("severity", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select severity</option>
                  {SEVERITY_OPTIONS.map((severity) => (
                    <option key={severity} value={severity}>
                      {severity}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Incident Type
                </label>
                <select
                  value={form.incident_type}
                  onChange={(event) =>
                    updateField("incident_type", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select type</option>
                  {INCIDENT_TYPE_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reported By
                </label>
                <select
                  value={form.reported_by}
                  onChange={(event) =>
                    updateField("reported_by", event.target.value)
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
                  Date Resolved
                </label>
                <input
                  type="date"
                  value={form.date_resolved}
                  onChange={(event) =>
                    updateField("date_resolved", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.escalated_to_mgmt}
                    onChange={(event) =>
                      updateField("escalated_to_mgmt", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Escalated to Management
                </label>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(event) =>
                    updateField("description", event.target.value)
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
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Incident"}
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
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Customer</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Description</th>
              <th className={scrollableTableThClassName}>Severity</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Escalated</th>
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
                  No incidents match the selected filters.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry, index) => (
                <tr
                  key={entry.incident_no}
                  className={
                    entry.escalated_to_mgmt
                      ? "bg-amber-50 text-slate-900"
                      : getStripedRowClassName(index)
                  }
                  title={
                    entry.reported_by
                      ? `Reported by: ${getIncidentReporterName(entry)}`
                      : undefined
                  }
                >
                  <td className="px-4 py-3">{formatDate(entry.date)}</td>
                  <td className="px-4 py-3">{getIncidentClientName(entry)}</td>
                  <td className="px-4 py-3">{getIncidentSiteName(entry)}</td>
                  <td className="px-4 py-3">
                    {truncateText(entry.description)}
                  </td>
                  <td className="px-4 py-3">{entry.severity ?? "—"}</td>
                  <td className="px-4 py-3">{entry.status ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.escalated_to_mgmt ? (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-800">
                        <span aria-hidden>⚠</span> Yes
                      </span>
                    ) : (
                      "No"
                    )}
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.incident_no)}
                    deleting={deletingId === entry.incident_no}
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
