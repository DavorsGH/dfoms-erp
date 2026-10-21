"use client";

import Tooltip from "@/components/ui/tooltip";
import TimePickerField from "@/components/time-picker-field";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useToast } from "@/components/feedback/feedback-context";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { fetchScopedActiveEmployees } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableWrapThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import type { HrEmployee } from "../hr-payroll/employee-utils";
import { formatDate, inputClassName } from "../hr-payroll/hr-register-utils";
import type { RosterContractProject } from "@/lib/roster-contract-choices";
import { useOperationsContracts } from "./use-operations-contracts";
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
} from "./operations-register-utils";
import { allocateIncidentNo } from "./operations-ids-api";
import type { SiteEntry } from "./sites-utils";
import { useOperationsReadOnly } from "./operations-read-only-context";

type IncidentRegisterProps = {
  initialEntries: IncidentRegisterEntry[];
  initialProjects: RosterContractProject[];
  initialSites: SiteEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
  tenantId?: string | null;
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
  initialProjects,
  initialSites,
  initialEmployees,
  fetchError,
  tenantId = null,
}: IncidentRegisterProps) {
  const supabase = createClient();
  const { toast } = useToast();
  const operationsReadOnly = useOperationsReadOnly();
  const buReadScope = useBusinessUnitReadScope();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeIncidentRegisterEntry),
  );
  const [employees, setEmployees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const contracts = useOperationsContracts(initialProjects, initialSites);
  const [filterSeverity, setFilterSeverity] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const skipFirstEmployeeScopeRefresh = useRef(true);

  useEffect(() => {
    setEntries(initialEntries.map(normalizeIncidentRegisterEntry));
  }, [initialEntries]);

  useEffect(() => {
    setEmployees(initialEmployees);
  }, [initialEmployees]);

  useEffect(() => {
    if (skipFirstEmployeeScopeRefresh.current) {
      skipFirstEmployeeScopeRefresh.current = false;
      return;
    }
    void (async () => {
      if (!tenantId) {
        setError("Unable to resolve your workspace.");
        return;
      }
      const scoped = await fetchScopedActiveEmployees(
        supabase,
        tenantId,
        buReadScope,
      );
      if (scoped.error) {
        setError(scoped.error);
        return;
      }
      setEmployees(scoped.employees);
      setError(null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional scope key
  }, [buReadScope.mode, buReadScope.mode === "unit" ? buReadScope.id : null]);

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      if (!contracts.matchesFilter(entry.client_id)) {
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
  }, [contracts, entries, filterSeverity, filterStatus]);

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
    contracts.setFormContractKey("");
    setEditingId(null);
    setForm({
      ...emptyForm,
      date: toDateInputValue(new Date().toISOString()),
      status: DEFAULT_INCIDENT_STATUS,
    });
    setShowForm(true);
  }

  function closeForm() {
    contracts.setFormContractKey("");
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function chooseContract(groupKey: string) {
    const choice = contracts.choices.find((entry) => entry.groupKey === groupKey);
    contracts.setFormContractKey(groupKey);
    setForm((current) => ({
      ...current,
      client_id: choice?.clientId ?? "",
      site_id: "",
    }));
  }

  function openEditForm(entry: IncidentRegisterEntry) {
    contracts.setFormContractKey(contracts.keyFor(entry.client_id, entry.site_id));
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
    if (!(await confirmDeleteEntry())) {
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

    if (contracts.formContractKey && !contracts.formChoice?.clientId) {
      setError(
        contracts.formChoice?.dataIssue ??
          "This contract has no customer, so the incident cannot be saved.",
      );
      setLoading(false);
      return;
    }

    const payload = {
      incident_no: form.incident_no.trim(),
      date: form.date,
      time: nullableText(form.time),
      client_id: nullableText(contracts.formChoice?.clientId ?? form.client_id),
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
    toast("Incident saved");
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Contract
            </label>
            <select
              value={contracts.filterContractKey}
              onChange={(event) => contracts.setFilterContractKey(event.target.value)}
              className={inputClassName}
            >
              <option value="">All contracts</option>
              {contracts.choices.map((choice) => (
                <option key={choice.groupKey} value={choice.groupKey}>
                  {choice.label}
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
        {!operationsReadOnly ? (
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Incident"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showForm && !operationsReadOnly ? (
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
                <TimePickerField
                  aria-label="Time"
                  value={form.time}
                  onChange={(value) => updateField("time", value)}
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
                  Contract
                </label>
                <select
                  value={contracts.formContractKey}
                  onChange={(event) => chooseContract(event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select contract</option>
                  {contracts.choices.map((choice) => (
                    <option key={choice.groupKey} value={choice.groupKey}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                {contracts.formChoice?.dataIssue ? (
                  <p className="mt-1 text-sm text-amber-700">
                    {contracts.formChoice.dataIssue}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Site
                </label>
                <select
                  value={form.site_id}
                  onChange={(event) => updateField("site_id", event.target.value)}
                  disabled={!contracts.formContractKey}
                  className={inputClassName}
                >
                  <option value="">
                    {contracts.formContractKey
                      ? "Select site"
                      : "Select a contract first"}
                  </option>
                  {contracts.formSites.map((site) => (
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
                  {employees.map((employee) => (
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

      <FilteredListCount
        filteredCount={filteredEntries.length}
        totalCount={entries.length}
        itemSingular="incident"
        hasActiveFilters={Boolean(
          contracts.filterContractKey || filterSeverity || filterStatus,
        )}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Contract</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableWrapThClassName}>Description</th>
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
                >
                  <td className="px-4 py-3">
                    {entry.reported_by ? (
                      <Tooltip
                        content={`Reported by: ${getIncidentReporterName(entry)}`}
                      >
                        <span>{formatDate(entry.date)}</span>
                      </Tooltip>
                    ) : (
                      formatDate(entry.date)
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {contracts.labelFor(
                      entry.client_id,
                      entry.site_id,
                      getIncidentClientName(entry),
                    )}
                  </td>
                  <td className="px-4 py-3">{getIncidentSiteName(entry)}</td>
                  <td className={scrollableTableWrapTdClassName}>
                    {entry.description?.trim() || "—"}
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
                    onEdit={
                      operationsReadOnly ? undefined : () => openEditForm(entry)
                    }
                    onDelete={
                      operationsReadOnly
                        ? undefined
                        : () => handleDelete(entry.incident_no)
                    }
                    deleting={deletingId === entry.incident_no}
                    disableEdit={operationsReadOnly}
                    disableDelete={operationsReadOnly}
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
