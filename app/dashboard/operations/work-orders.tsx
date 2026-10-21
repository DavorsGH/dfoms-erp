"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import TimePickerField from "@/components/time-picker-field";
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
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
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
import {
  contractKeyForStoredRecord,
  contractLabelForStoredRecord,
  listOperationsContractChoices,
  siteProjectCode,
  sitesForContract,
  staffForSelectedSite,
} from "@/lib/operations-contract-scope";
import type { RosterContractProject } from "@/lib/roster-contract-choices";
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
import { useOperationsReadOnly } from "./operations-read-only-context";

type LinkedInspectionOption = {
  checklist_id: string;
  inspection_date: string | null;
  site_id: string | null;
};

type WorkOrdersProps = {
  initialWorkOrders: WorkOrderEntry[];
  initialProjects: RosterContractProject[];
  initialSites: SiteEntry[];
  initialEmployees: HrEmployee[];
  initialInspections: LinkedInspectionOption[];
  inspectionPassingThreshold: number;
  fetchError: string | null;
  tenantId?: string | null;
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
  initialProjects,
  initialSites,
  initialEmployees,
  initialInspections,
  inspectionPassingThreshold,
  fetchError,
  tenantId = null,
}: WorkOrdersProps) {
  const supabase = createClient();
  const { toast } = useToast();
  const operationsReadOnly = useOperationsReadOnly();
  const buReadScope = useBusinessUnitReadScope();
  const [workOrders, setWorkOrders] = useState(
    initialWorkOrders.map(normalizeWorkOrderEntry),
  );
  const [employees, setEmployees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingNo, setEditingNo] = useState<string | null>(null);
  const [deletingNo, setDeletingNo] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterContractKey, setFilterContractKey] = useState("");
  const [formContractKey, setFormContractKey] = useState("");
  const [showAllStaff, setShowAllStaff] = useState(false);
  const [filterSite, setFilterSite] = useState("");
  const [filterPassFail, setFilterPassFail] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const skipFirstEmployeeScopeRefresh = useRef(true);

  useEffect(() => {
    setWorkOrders(initialWorkOrders.map(normalizeWorkOrderEntry));
  }, [initialWorkOrders]);

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

  const contractChoices = useMemo(
    () =>
      listOperationsContractChoices({
        projects: initialProjects,
        sites: initialSites.map((site) => ({
          client_id: site.client_id,
          project_code: siteProjectCode(site) || null,
        })),
      }),
    [initialProjects, initialSites],
  );
  const filterContract =
    contractChoices.find((choice) => choice.groupKey === filterContractKey) ??
    null;
  const formContract =
    contractChoices.find((choice) => choice.groupKey === formContractKey) ??
    null;

  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((entry) => {
      if (
        filterContractKey &&
        (entry.client_id ?? "") !== (filterContract?.clientId ?? "")
      ) {
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
    filterContract?.clientId,
    filterContractKey,
    filterDateFrom,
    filterDateTo,
    filterPassFail,
    filterSite,
    workOrders,
  ]);

  const filterSiteOptions = useMemo(() => {
    if (!filterContractKey) {
      return initialSites;
    }

    return sitesForContract(initialSites, filterContractKey, initialProjects);
  }, [filterContractKey, initialProjects, initialSites]);

  const formSiteOptions = useMemo(() => {
    if (!formContractKey) {
      return [];
    }

    return sitesForContract(initialSites, formContractKey, initialProjects);
  }, [formContractKey, initialProjects, initialSites]);

  const inspectionOptions = useMemo(() => {
    const forSite = initialInspections.filter(
      (inspection) => inspection.site_id === form.site_id,
    );
    if (
      form.checklist_id &&
      !forSite.some((inspection) => inspection.checklist_id === form.checklist_id)
    ) {
      return [
        {
          checklist_id: form.checklist_id,
          inspection_date: null,
          site_id: form.site_id,
        },
        ...forSite,
      ];
    }
    return forSite;
  }, [form.checklist_id, form.site_id, initialInspections]);

  const cleanerOptions = useMemo(
    () =>
      staffForSelectedSite(
        employees,
        form.site_id,
        showAllStaff,
        form.assigned_cleaner,
      ),
    [employees, form.assigned_cleaner, form.site_id, showAllStaff],
  );

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

  function storedContractKey(clientId: string | null, siteId: string | null) {
    const site = initialSites.find((entry) => entry.site_code === siteId);
    return contractKeyForStoredRecord({
      clientId,
      siteProjectCode: siteProjectCode(site),
      projects: initialProjects,
      choices: contractChoices,
    });
  }

  function selectFormContract(groupKey: string) {
    const choice = contractChoices.find((entry) => entry.groupKey === groupKey);
    setFormContractKey(groupKey);
    setShowAllStaff(false);
    setForm((current) => ({
      ...current,
      client_id: choice?.clientId ?? "",
      site_id: "",
      checklist_id: "",
      assigned_cleaner: "",
    }));
  }

  function openAddForm() {
    setEditingNo(null);
    setFormContractKey("");
    setShowAllStaff(false);
    setForm({
      ...emptyForm,
      date: toDateInputValue(new Date().toISOString()),
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingNo(null);
    setFormContractKey("");
    setShowAllStaff(false);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: WorkOrderEntry) {
    setEditingNo(entry.work_order_no);
    setFormContractKey(storedContractKey(entry.client_id, entry.site_id));
    setShowAllStaff(false);
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
    if (field === "site_id" && value !== form.site_id) {
      setShowAllStaff(false);
    }
    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "site_id" && value !== current.site_id) {
        next.checklist_id = "";
        next.assigned_cleaner = "";
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
    if (!(await confirmDeleteEntry())) {
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

    if (formContractKey && !formContract?.clientId) {
      setError(
        formContract?.dataIssue ??
          "This contract has no customer, so the work order cannot be saved.",
      );
      setLoading(false);
      return;
    }

    const payload = {
      work_order_no: form.work_order_no.trim(),
      checklist_id: nullableText(form.checklist_id),
      ref_po_no: nullableText(form.ref_po_no),
      date: form.date,
      client_id: nullableText(formContract?.clientId ?? form.client_id),
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
    toast(editingNo ? "Work order saved" : "Work order created");
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Filter by Contract
            </label>
            <select
              value={filterContractKey}
              onChange={(event) => {
                setFilterContractKey(event.target.value);
                setFilterSite("");
              }}
              className={inputClassName}
            >
              <option value="">All contracts</option>
              {contractChoices.map((choice) => (
                <option key={choice.groupKey} value={choice.groupKey}>
                  {choice.label}
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
        {!operationsReadOnly ? (
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Work Order"}
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
                  Linked inspection (optional)
                </label>
                <select
                  value={form.checklist_id}
                  onChange={(event) =>
                    updateField("checklist_id", event.target.value)
                  }
                  disabled={!form.site_id}
                  className={inputClassName}
                >
                  <option value="">
                    {form.site_id ? "None" : "Select a site first"}
                  </option>
                  {inspectionOptions.map((inspection) => (
                    <option
                      key={inspection.checklist_id}
                      value={inspection.checklist_id}
                    >
                      {inspection.inspection_date
                        ? `${inspection.checklist_id} — ${formatDate(inspection.inspection_date)}`
                        : inspection.checklist_id}
                    </option>
                  ))}
                </select>
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
                  Contract
                </label>
                <select
                  value={formContractKey}
                  onChange={(event) => selectFormContract(event.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select contract</option>
                  {contractChoices.map((choice) => (
                    <option key={choice.groupKey} value={choice.groupKey}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                {formContract?.dataIssue ? (
                  <p className="mt-1 text-sm text-amber-700">
                    {formContract.dataIssue}
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
                  disabled={!formContractKey}
                  className={inputClassName}
                >
                  <option value="">
                    {formContractKey ? "Select site" : "Select a contract first"}
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
                <div className="mb-1 flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Assigned Cleaner
                  </label>
                  <label className="flex items-center gap-1 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={showAllStaff}
                      onChange={(event) => setShowAllStaff(event.target.checked)}
                    />
                    Show all staff
                  </label>
                </div>
                <select
                  value={form.assigned_cleaner}
                  onChange={(event) =>
                    updateField("assigned_cleaner", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select cleaner</option>
                  {cleanerOptions.map((employee) => (
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
                  {employees.map((employee) => (
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
                <TimePickerField
                  aria-label="Start Time"
                  value={form.start_time}
                  onChange={(value) => updateField("start_time", value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Completion Time
                </label>
                <TimePickerField
                  aria-label="Completion Time"
                  value={form.completion_time}
                  onChange={(value) => updateField("completion_time", value)}
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

      <FilteredListCount
        filteredCount={filteredWorkOrders.length}
        totalCount={workOrders.length}
        itemSingular="work order"
        itemPlural="work orders"
        hasActiveFilters={Boolean(
          filterContractKey ||
            filterSite ||
            filterPassFail ||
            filterDateFrom ||
            filterDateTo,
        )}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Contract</th>
              <th className={scrollableTableThClassName}>Work Order No</th>
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
                  <td className="px-4 py-3">{formatDate(entry.date)}</td>
                  <td className="px-4 py-3">
                    {contractLabelForStoredRecord(
                      {
                        clientId: entry.client_id,
                        siteProjectCode: siteProjectCode(
                          initialSites.find(
                            (site) => site.site_code === entry.site_id,
                          ),
                        ),
                        projects: initialProjects,
                        choices: contractChoices,
                      },
                      getWorkOrderClientName(entry),
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {entry.work_order_no}
                  </td>
                  <td className="px-4 py-3">{getWorkOrderSiteName(entry)}</td>
                  <td className="px-4 py-3">{entry.service_type ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.assigned_cleaner
                      ? getEmployeeDisplayName(
                          employees,
                          entry.assigned_cleaner,
                        )
                      : "—"}
                  </td>
                  <td className="px-4 py-3">{entry.pass_fail ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.checked_by_sup ? "Yes" : "No"}
                  </td>
                  <RegisterRowActions
                    onEdit={
                      operationsReadOnly
                        ? undefined
                        : () => openEditForm(entry)
                    }
                    onDelete={
                      operationsReadOnly
                        ? undefined
                        : () => handleDelete(entry.work_order_no)
                    }
                    deleting={deletingNo === entry.work_order_no}
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
