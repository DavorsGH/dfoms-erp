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
import {
  formatDate,
  formatTime,
  inputClassName,
  toTimeInputValue,
} from "../hr-payroll/hr-register-utils";
import type { ClientEntry } from "./clients-utils";
import {
  calculateDurationMinutes,
  derivePassFailFromScore,
  nullableInteger,
  nullableNumber,
  nullableText,
  PASS_FAIL_OPTIONS,
} from "./operations-register-utils";
import { allocateWorkOrderNo } from "./operations-ids-api";
import type { SiteEntry } from "./sites-utils";
import {
  getWorkOrderClientName,
  getWorkOrderSiteName,
  normalizeWorkOrderEntry,
  WORK_ORDER_SELECT,
  type WorkOrderEntry,
} from "./work-orders-utils";

type WorkOrdersProps = {
  initialWorkOrders: WorkOrderEntry[];
  initialClients: ClientEntry[];
  initialSites: SiteEntry[];
  initialEmployees: HrEmployee[];
  inspectionPassingThreshold: number;
  fetchError: string | null;
};

const emptyForm = {
  work_order_no: "",
  checklist_id: "",
  ref_po_no: "",
  date: "",
  client_id: "",
  site_id: "",
  area: "",
  service_type: "",
  assigned_cleaner: "",
  supervisor: "",
  start_time: "",
  completion_time: "",
  duration_min: "",
  inspection_score_pct: "",
  pass_fail: "",
  checked_by_sup: false,
  remarks: "",
};

export default function WorkOrders({
  initialWorkOrders,
  initialClients,
  initialSites,
  initialEmployees,
  inspectionPassingThreshold,
  fetchError,
}: WorkOrdersProps) {
  const supabase = createClient();
  const [workOrders, setWorkOrders] = useState(
    initialWorkOrders.map(normalizeWorkOrderEntry),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingNo, setEditingNo] = useState<string | null>(null);
  const [deletingNo, setDeletingNo] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterClient, setFilterClient] = useState("");
  const [filterSite, setFilterSite] = useState("");
  const [filterPassFail, setFilterPassFail] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  useEffect(() => {
    setWorkOrders(initialWorkOrders.map(normalizeWorkOrderEntry));
  }, [initialWorkOrders]);

  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((entry) => {
      if (filterClient && (entry.client_id ?? "") !== filterClient) {
        return false;
      }

      if (filterSite && (entry.site_id ?? "") !== filterSite) {
        return false;
      }

      if (filterPassFail && (entry.pass_fail ?? "") !== filterPassFail) {
        return false;
      }

      const entryDate = entry.date.slice(0, 10);
      if (filterDateFrom && entryDate < filterDateFrom) {
        return false;
      }

      if (filterDateTo && entryDate > filterDateTo) {
        return false;
      }

      return true;
    });
  }, [
    filterClient,
    filterDateFrom,
    filterDateTo,
    filterPassFail,
    filterSite,
    workOrders,
  ]);

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

  async function refreshWorkOrders() {
    const { data, error: refreshError } = await supabase
      .from("work_orders")
      .select(WORK_ORDER_SELECT)
      .order("date", { ascending: false })
      .order("work_order_no", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setWorkOrders(
      ((data as WorkOrderEntry[] | null) ?? []).map(normalizeWorkOrderEntry),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingNo(null);
    setForm({
      ...emptyForm,
      date: toDateInputValue(new Date().toISOString()),
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingNo(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: WorkOrderEntry) {
    setEditingNo(entry.work_order_no);
    setForm({
      work_order_no: entry.work_order_no,
      checklist_id: entry.checklist_id ?? "",
      ref_po_no: entry.ref_po_no ?? "",
      date: toDateInputValue(entry.date),
      client_id: entry.client_id ?? "",
      site_id: entry.site_id ?? "",
      area: entry.area ?? "",
      service_type: entry.service_type ?? "",
      assigned_cleaner: entry.assigned_cleaner ?? "",
      supervisor: entry.supervisor ?? "",
      start_time: toTimeInputValue(entry.start_time),
      completion_time: toTimeInputValue(entry.completion_time),
      duration_min:
        entry.duration_min == null ? "" : String(entry.duration_min),
      inspection_score_pct:
        entry.inspection_score_pct == null
          ? ""
          : String(entry.inspection_score_pct),
      pass_fail: entry.pass_fail ?? "",
      checked_by_sup: Boolean(entry.checked_by_sup),
      remarks: entry.remarks ?? "",
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

      if (field === "start_time" || field === "completion_time") {
        const duration = calculateDurationMinutes(
          field === "start_time" ? String(value) : next.start_time,
          field === "completion_time" ? String(value) : next.completion_time,
        );
        if (duration != null) {
          next.duration_min = String(duration);
        }
      }

      if (field === "inspection_score_pct") {
        const derived = derivePassFailFromScore(
          nullableNumber(String(value)),
          inspectionPassingThreshold,
        );
        if (derived) {
          next.pass_fail = derived;
        }
      }

      return next;
    });
  }

  async function handleDelete(workOrderNo: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingNo(workOrderNo);
    setError(null);

    const { error: deleteError } = await supabase
      .from("work_orders")
      .delete()
      .eq("work_order_no", workOrderNo);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingNo(null);
      return;
    }

    if (editingNo === workOrderNo) {
      closeForm();
    }

    await refreshWorkOrders();
    setDeletingNo(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      work_order_no: form.work_order_no.trim(),
      checklist_id: nullableText(form.checklist_id),
      ref_po_no: nullableText(form.ref_po_no),
      date: form.date,
      client_id: nullableText(form.client_id),
      site_id: nullableText(form.site_id),
      area: nullableText(form.area),
      service_type: nullableText(form.service_type),
      assigned_cleaner: nullableText(form.assigned_cleaner),
      supervisor: nullableText(form.supervisor),
      start_time: nullableText(form.start_time),
      completion_time: nullableText(form.completion_time),
      duration_min: nullableInteger(form.duration_min),
      inspection_score_pct: nullableNumber(form.inspection_score_pct),
      pass_fail: nullableText(form.pass_fail),
      checked_by_sup: form.checked_by_sup,
      remarks: nullableText(form.remarks),
    };

    if (editingNo) {
      const { error: saveError } = await supabase
        .from("work_orders")
        .update({
          checklist_id: payload.checklist_id,
          ref_po_no: payload.ref_po_no,
          date: payload.date,
          client_id: payload.client_id,
          site_id: payload.site_id,
          area: payload.area,
          service_type: payload.service_type,
          assigned_cleaner: payload.assigned_cleaner,
          supervisor: payload.supervisor,
          start_time: payload.start_time,
          completion_time: payload.completion_time,
          duration_min: payload.duration_min,
          inspection_score_pct: payload.inspection_score_pct,
          pass_fail: payload.pass_fail,
          checked_by_sup: payload.checked_by_sup,
          remarks: payload.remarks,
        })
        .eq("work_order_no", editingNo);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateWorkOrderNo(supabase);
      if (allocated.error || !allocated.workOrderNo) {
        setError(allocated.error ?? "Unable to allocate work order number.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("work_orders").insert({
        ...payload,
        work_order_no: allocated.workOrderNo,
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshWorkOrders();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Customer
            </label>
            <select
              value={filterClient}
              onChange={(event) => {
                setFilterClient(event.target.value);
                setFilterSite("");
              }}
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
          {showForm ? "Cancel" : "Add Work Order"}
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
            {editingNo ? "Edit Work Order" : "New Work Order"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingNo ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Work Order No
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={form.work_order_no}
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
                  Checklist ID
                </label>
                <input
                  type="text"
                  value={form.checklist_id}
                  onChange={(event) =>
                    updateField("checklist_id", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Ref PO No
                </label>
                <input
                  type="text"
                  value={form.ref_po_no}
                  onChange={(event) => updateField("ref_po_no", event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Customer
                </label>
                <select
                  value={form.client_id}
                  onChange={(event) =>
                    updateField("client_id", event.target.value)
                  }
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
                  Service Type
                </label>
                <input
                  type="text"
                  value={form.service_type}
                  onChange={(event) =>
                    updateField("service_type", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Assigned Cleaner
                </label>
                <select
                  value={form.assigned_cleaner}
                  onChange={(event) =>
                    updateField("assigned_cleaner", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select cleaner</option>
                  {initialEmployees.map((employee) => (
                    <option key={employee.employee_id} value={employee.employee_id}>
                      {employee.staff_id} — {employee.full_name}
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
                  Start Time
                </label>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(event) =>
                    updateField("start_time", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Completion Time
                </label>
                <input
                  type="time"
                  value={form.completion_time}
                  onChange={(event) =>
                    updateField("completion_time", event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Duration (min)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.duration_min}
                  onChange={(event) =>
                    updateField("duration_min", event.target.value)
                  }
                  className={inputClassName}
                />
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
                <p className="mt-1 text-xs text-slate-500">
                  Auto-suggested at {inspectionPassingThreshold}% threshold when
                  score is entered.
                </p>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.checked_by_sup}
                    onChange={(event) =>
                      updateField("checked_by_sup", event.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Checked by Supervisor
                </label>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Remarks
                </label>
                <textarea
                  value={form.remarks}
                  onChange={(event) => updateField("remarks", event.target.value)}
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
                {loading
                  ? "Saving…"
                  : editingNo
                    ? "Save Changes"
                    : "Add Work Order"}
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
              <th className={scrollableTableThClassName}>Work Order No</th>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Customer</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Service Type</th>
              <th className={scrollableTableThClassName}>Assigned Cleaner</th>
              <th className={scrollableTableThClassName}>Pass/Fail</th>
              <th className={scrollableTableThClassName}>Checked by Supervisor</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredWorkOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No work orders match the selected filters.
                </td>
              </tr>
            ) : (
              filteredWorkOrders.map((entry, index) => (
                <tr key={entry.work_order_no} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {entry.work_order_no}
                  </td>
                  <td className="px-4 py-3">{formatDate(entry.date)}</td>
                  <td className="px-4 py-3">{getWorkOrderClientName(entry)}</td>
                  <td className="px-4 py-3">{getWorkOrderSiteName(entry)}</td>
                  <td className="px-4 py-3">{entry.service_type ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.assigned_cleaner
                      ? getEmployeeDisplayName(
                          initialEmployees,
                          entry.assigned_cleaner,
                        )
                      : "—"}
                  </td>
                  <td className="px-4 py-3">{entry.pass_fail ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.checked_by_sup ? "Yes" : "No"}
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.work_order_no)}
                    deleting={deletingNo === entry.work_order_no}
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
