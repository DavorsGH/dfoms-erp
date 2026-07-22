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
  derivePassFailFromScore,
  nullableNumber,
  nullableText,
  PASS_FAIL_OPTIONS,
} from "./operations-register-utils";
import {
  getInspectionClientName,
  getInspectionSiteName,
  INSPECTION_SUMMARY_SELECT,
  normalizeInspectionSummaryEntry,
  type InspectionSummaryEntry,
  type WorkOrderLookup,
} from "./inspection-summary-utils";
import { allocateChecklistId } from "./operations-ids-api";
import type { SiteEntry } from "./sites-utils";

type InspectionSummaryProps = {
  initialEntries: InspectionSummaryEntry[];
  initialClients: ClientEntry[];
  initialSites: SiteEntry[];
  initialWorkOrders: WorkOrderLookup[];
  initialEmployees: HrEmployee[];
  inspectionPassingThreshold: number;
  fetchError: string | null;
};

const emptyForm = {
  checklist_id: "",
  inspection_date: "",
  work_order_no: "",
  client_id: "",
  site_id: "",
  supervisor: "",
  inspection_score_pct: "",
  pass_fail: "",
  critical_findings: "",
  recommendations: "",
  next_inspection_date: "",
  status: "",
};

export default function InspectionSummary({
  initialEntries,
  initialClients,
  initialSites,
  initialWorkOrders,
  initialEmployees,
  inspectionPassingThreshold,
  fetchError,
}: InspectionSummaryProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeInspectionSummaryEntry),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterClient, setFilterClient] = useState("");
  const [filterSite, setFilterSite] = useState("");
  const [filterPassFail, setFilterPassFail] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  useEffect(() => {
    setEntries(initialEntries.map(normalizeInspectionSummaryEntry));
  }, [initialEntries]);

  const filterSiteOptions = useMemo(() => {
    if (!filterClient) {
      return initialSites;
    }

    return initialSites.filter((site) => site.client_id === filterClient);
  }, [filterClient, initialSites]);

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

      if (filterSite && (entry.site_id ?? "") !== filterSite) {
        return false;
      }

      if (filterPassFail && (entry.pass_fail ?? "") !== filterPassFail) {
        return false;
      }

      const entryDate = entry.inspection_date.slice(0, 10);
      if (filterDateFrom && entryDate < filterDateFrom) {
        return false;
      }

      if (filterDateTo && entryDate > filterDateTo) {
        return false;
      }

      return true;
    });
  }, [
    entries,
    filterClient,
    filterDateFrom,
    filterDateTo,
    filterPassFail,
    filterSite,
  ]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("inspection_summary")
      .select(INSPECTION_SUMMARY_SELECT)
      .order("inspection_date", { ascending: false })
      .order("checklist_id", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as InspectionSummaryEntry[] | null) ?? []).map(
        normalizeInspectionSummaryEntry,
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyForm,
      inspection_date: toDateInputValue(new Date().toISOString()),
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: InspectionSummaryEntry) {
    setEditingId(entry.checklist_id);
    setForm({
      checklist_id: entry.checklist_id,
      inspection_date: toDateInputValue(entry.inspection_date),
      work_order_no: entry.work_order_no ?? "",
      client_id: entry.client_id ?? "",
      site_id: entry.site_id ?? "",
      supervisor: entry.supervisor ?? "",
      inspection_score_pct:
        entry.inspection_score_pct == null
          ? ""
          : String(entry.inspection_score_pct),
      pass_fail: entry.pass_fail ?? "",
      critical_findings: entry.critical_findings ?? "",
      recommendations: entry.recommendations ?? "",
      next_inspection_date: entry.next_inspection_date
        ? toDateInputValue(entry.next_inspection_date)
        : "",
      status: entry.status ?? "",
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "client_id" && value !== current.client_id) {
        next.site_id = "";
      }

      if (field === "work_order_no" && value) {
        const workOrder = initialWorkOrders.find(
          (entry) => entry.work_order_no === value,
        );
        if (workOrder) {
          next.client_id = workOrder.client_id ?? "";
          next.site_id = workOrder.site_id ?? "";
        }
      }

      if (field === "inspection_score_pct") {
        const derived = derivePassFailFromScore(
          nullableNumber(value),
          inspectionPassingThreshold,
        );
        if (derived) {
          next.pass_fail = derived;
        }
      }

      return next;
    });
  }

  async function handleDelete(checklistId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(checklistId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("inspection_summary")
      .delete()
      .eq("checklist_id", checklistId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === checklistId) {
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
      inspection_date: form.inspection_date,
      work_order_no: nullableText(form.work_order_no),
      client_id: nullableText(form.client_id),
      site_id: nullableText(form.site_id),
      supervisor: nullableText(form.supervisor),
      inspection_score_pct: nullableNumber(form.inspection_score_pct),
      pass_fail: nullableText(form.pass_fail),
      critical_findings: nullableText(form.critical_findings),
      recommendations: nullableText(form.recommendations),
      next_inspection_date: nullableText(form.next_inspection_date),
      status: nullableText(form.status),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("inspection_summary")
        .update(payload)
        .eq("checklist_id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateChecklistId(supabase);
      if (allocated.error || !allocated.checklistId) {
        setError(allocated.error ?? "Unable to allocate checklist ID.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("inspection_summary")
        .insert({
          ...payload,
          checklist_id: allocated.checklistId,
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Client
            </label>
            <select
              value={filterClient}
              onChange={(event) => {
                setFilterClient(event.target.value);
                setFilterSite("");
              }}
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
              Filter by Site
            </label>
            <select
              value={filterSite}
              onChange={(event) => setFilterSite(event.target.value)}
              className={inputClassName}
            >
              <option value="">All sites</option>
              {filterSiteOptions.map((site) => (
                <option key={site.site_code} value={site.site_code}>
                  {site.site_name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Pass/Fail
            </label>
            <select
              value={filterPassFail}
              onChange={(event) => setFilterPassFail(event.target.value)}
              className={inputClassName}
            >
              <option value="">All results</option>
              {PASS_FAIL_OPTIONS.map((result) => (
                <option key={result} value={result}>
                  {result}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Date From
            </label>
            <input
              type="date"
              value={filterDateFrom}
              onChange={(event) => setFilterDateFrom(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Date To
            </label>
            <input
              type="date"
              value={filterDateTo}
              onChange={(event) => setFilterDateTo(event.target.value)}
              className={inputClassName}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Inspection"}
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
            {editingId ? "Edit Inspection" : "New Inspection"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Checklist ID
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.checklist_id}
                    className={`${inputClassName} bg-slate-50 text-slate-600`}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Inspection Date
                </label>
                <input
                  type="date"
                  required
                  value={form.inspection_date}
                  onChange={(event) =>
                    updateField("inspection_date", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Work Order
                </label>
                <select
                  value={form.work_order_no}
                  onChange={(event) =>
                    updateField("work_order_no", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select work order</option>
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
                  Supervisor
                </label>
                <select
                  value={form.supervisor}
                  onChange={(event) => updateField("supervisor", event.target.value)}
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
                  Inspection Score (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={form.inspection_score_pct}
                  onChange={(event) =>
                    updateField("inspection_score_pct", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Pass / Fail
                </label>
                <select
                  value={form.pass_fail}
                  onChange={(event) => updateField("pass_fail", event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select result</option>
                  {PASS_FAIL_OPTIONS.map((result) => (
                    <option key={result} value={result}>
                      {result}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Next Inspection Date
                </label>
                <input
                  type="date"
                  value={form.next_inspection_date}
                  onChange={(event) =>
                    updateField("next_inspection_date", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Status
                </label>
                <input
                  type="text"
                  value={form.status}
                  onChange={(event) => updateField("status", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Critical Findings
                </label>
                <textarea
                  value={form.critical_findings}
                  onChange={(event) =>
                    updateField("critical_findings", event.target.value)
                  }
                  rows={2}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Recommendations
                </label>
                <textarea
                  value={form.recommendations}
                  onChange={(event) =>
                    updateField("recommendations", event.target.value)
                  }
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
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Inspection"}
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
              <th className={scrollableTableThClassName}>Inspection Date</th>
              <th className={scrollableTableThClassName}>Client</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Supervisor</th>
              <th className={scrollableTableThClassName}>Score %</th>
              <th className={scrollableTableThClassName}>Pass/Fail</th>
              <th className={scrollableTableThClassName}>Status</th>
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
                  No inspections match the selected filters.
                </td>
              </tr>
            ) : (
              filteredEntries.map((entry, index) => (
                <tr key={entry.checklist_id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{formatDate(entry.inspection_date)}</td>
                  <td className="px-4 py-3">{getInspectionClientName(entry)}</td>
                  <td className="px-4 py-3">{getInspectionSiteName(entry)}</td>
                  <td className="px-4 py-3">
                    {entry.supervisor
                      ? getEmployeeDisplayName(initialEmployees, entry.supervisor)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {entry.inspection_score_pct ?? "—"}
                  </td>
                  <td className="px-4 py-3">{entry.pass_fail ?? "—"}</td>
                  <td className="px-4 py-3">{entry.status ?? "—"}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.checklist_id)}
                    deleting={deletingId === entry.checklist_id}
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
