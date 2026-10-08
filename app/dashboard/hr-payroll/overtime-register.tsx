"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { Approver } from "../lookup-types";
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
import { getEmployeeDisplayName, type HrEmployee } from "./employee-utils";
import type { OvertimeRegisterEntry } from "./overtime-register-utils";
import OvertimeBulkConfirmDialog, {
  type OvertimeBulkConfirmEmployee,
} from "./overtime-bulk-confirm-dialog";
import OvertimeEmployeeMultiSelect from "./overtime-employee-multi-select";
import {
  OVERTIME_DAY_TYPE_NORMAL,
  OVERTIME_DAY_TYPE_REST,
  displayOvertimeDayType,
  hasOvertimeFieldErrors,
  normalizeOvertimeDayType,
  overtimeAmountPreviewBlocked,
  overtimeEntryInputFromFormStrings,
  pickOvertimeErrorsForLiveValidation,
  validateOvertimeEntryInput,
  type OvertimeDayType,
  type OvertimeEntryFieldErrors,
  type OvertimeLiveValidatedField,
} from "./overtime-register-validation";
import {
  calculateOvertimeAmount,
  formatDate,
  formatGHS,
  inputClassName,
} from "./hr-register-utils";

type OvertimeRegisterProps = {
  initialEntries: OvertimeRegisterEntry[];
  initialEmployees: HrEmployee[];
  initialApprovers: Approver[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  employee_ids: [] as string[],
  employee_id: "",
  day_type: OVERTIME_DAY_TYPE_NORMAL as OvertimeDayType,
  hours_worked: "",
  overtime_hours: "",
  overtime_rate: "",
  approved_by: "",
};

export default function OvertimeRegister({
  initialEntries,
  initialEmployees,
  initialApprovers,
  fetchError,
}: OvertimeRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [approvers] = useState(initialApprovers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<OvertimeEntryFieldErrors>({});
  const [liveValidatedFields, setLiveValidatedFields] = useState<
    Set<OvertimeLiveValidatedField>
  >(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [confirmBulk, setConfirmBulk] = useState<{
    employees: OvertimeBulkConfirmEmployee[];
    parsed: {
      date: string;
      day_type: OvertimeDayType;
      hours_worked: number;
      overtime_hours: number;
      overtime_rate: number;
      approved_by: string;
    };
  } | null>(null);

  const previewOvertimeAmount = useMemo(() => {
    if (overtimeAmountPreviewBlocked(form)) {
      return null;
    }
    return calculateOvertimeAmount(
      Number(form.overtime_hours) || 0,
      Number(form.overtime_rate) || 0,
    );
  }, [form]);

  const employeeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const employee of employees) {
      map.set(employee.employee_id, employee.full_name);
    }
    return map;
  }, [employees]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("overtime_register")
      .select("*")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as OvertimeRegisterEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setLoading(false);
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setLiveValidatedFields(new Set());
    setShowForm(true);
  }

  function closeForm() {
    setLoading(false);
    setEditingId(null);
    setForm(emptyForm);
    setFieldErrors({});
    setLiveValidatedFields(new Set());
    setShowForm(false);
    setConfirmBulk(null);
  }

  function openEditForm(entry: OvertimeRegisterEntry) {
    setLoading(false);
    setEditingId(entry.id);
    setFieldErrors({});
    setLiveValidatedFields(new Set());
    setForm({
      date: toDateInputValue(entry.date),
      employee_ids: [],
      employee_id: entry.employee_id,
      day_type:
        normalizeOvertimeDayType(entry.day_type) ?? OVERTIME_DAY_TYPE_NORMAL,
      hours_worked:
        entry.hours_worked === null ? "" : String(entry.hours_worked),
      overtime_hours: String(entry.overtime_hours),
      overtime_rate: String(entry.overtime_rate),
      approved_by: entry.approved_by ?? "",
    });
    setShowForm(true);
  }

  function applyLiveFieldValidation(
    nextForm: typeof emptyForm,
    validatedFields: Set<OvertimeLiveValidatedField>,
  ) {
    const dayType = normalizeOvertimeDayType(nextForm.day_type);
    const input = overtimeEntryInputFromFormStrings(nextForm);
    const fullErrors = validateOvertimeEntryInput(input);
    if (!dayType) {
      fullErrors.day_type = "Day type is required.";
    }
    setFieldErrors(
      pickOvertimeErrorsForLiveValidation(fullErrors, validatedFields),
    );
  }

  function extendLiveValidatedFields(
    current: Set<OvertimeLiveValidatedField>,
    field: OvertimeLiveValidatedField,
  ): Set<OvertimeLiveValidatedField> {
    const next = new Set(current);
    next.add(field);
    if (field === "hours_worked" || field === "overtime_hours") {
      next.add("hours_worked");
      next.add("overtime_hours");
    }
    return next;
  }

  function handleFieldBlur(field: OvertimeLiveValidatedField) {
    setLiveValidatedFields((current) => {
      const next = extendLiveValidatedFields(current, field);
      applyLiveFieldValidation(form, next);
      return next;
    });
  }

  function updateField<K extends keyof typeof emptyForm>(
    field: K,
    value: (typeof emptyForm)[K],
  ) {
    const liveField = field as OvertimeLiveValidatedField;
    const liveFields: OvertimeLiveValidatedField[] = [
      "date",
      "day_type",
      "hours_worked",
      "overtime_hours",
      "overtime_rate",
      "approved_by",
    ];

    setForm((current) => {
      const next = { ...current, [field]: value };

      if (field === "day_type" && value === OVERTIME_DAY_TYPE_REST) {
        const hours = Number(next.hours_worked);
        if (Number.isFinite(hours) && hours > 0) {
          next.overtime_hours = String(hours);
        }
      }

      if (field === "hours_worked" && next.day_type === OVERTIME_DAY_TYPE_REST) {
        const hours = Number(value);
        if (Number.isFinite(hours) && hours > 0) {
          next.overtime_hours = String(hours);
        }
      }

      if (liveFields.includes(liveField)) {
        setLiveValidatedFields((currentValidated) => {
          const nextValidated = extendLiveValidatedFields(
            currentValidated,
            liveField,
          );
          applyLiveFieldValidation(next, nextValidated);
          return nextValidated;
        });
      }

      return next;
    });
  }

  function buildValidatedInput(): {
    ok: true;
    input: {
      date: string;
      day_type: OvertimeDayType;
      hours_worked: number;
      overtime_hours: number;
      overtime_rate: number;
      approved_by: string;
    };
  } | { ok: false } {
    const dayType = normalizeOvertimeDayType(form.day_type);
    const input = overtimeEntryInputFromFormStrings(form);

    const errors = validateOvertimeEntryInput(input);
    if (!editingId && form.employee_ids.length === 0) {
      errors.employee_ids = "Select at least one employee.";
    }
    if (editingId && !form.employee_id.trim()) {
      errors.employee_ids = "Employee is required.";
    }
    if (!dayType) {
      errors.day_type = "Day type is required.";
    }

    setFieldErrors(errors);
    if (hasOvertimeFieldErrors(errors)) {
      return { ok: false };
    }

    return { ok: true, input };
  }

  async function handleDelete(id: string) {
    if (!(await confirmDeleteEntry())) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("overtime_register")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === id) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const validated = buildValidatedInput();
    if (!validated.ok) {
      return;
    }

    if (editingId) {
      void submitEdit(validated.input);
      return;
    }

    const dateKey = validated.input.date.slice(0, 10);
    const duplicateIds = new Set(
      entries
        .filter(
          (entry) =>
            entry.date.slice(0, 10) === dateKey &&
            form.employee_ids.includes(entry.employee_id),
        )
        .map((entry) => entry.employee_id),
    );

    const confirmEmployees: OvertimeBulkConfirmEmployee[] = form.employee_ids
      .map((employeeId) => ({
        employee_id: employeeId,
        full_name: employeeNameById.get(employeeId) ?? employeeId,
        hasDuplicateOnDate: duplicateIds.has(employeeId),
      }))
      .sort((left, right) => left.full_name.localeCompare(right.full_name));

    setConfirmBulk({
      employees: confirmEmployees,
      parsed: validated.input,
    });
  }

  async function submitBulk(
    employeeIds: string[],
    parsed: NonNullable<typeof confirmBulk>["parsed"],
  ) {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/hr-payroll/overtime-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_ids: employeeIds,
          date: parsed.date,
          day_type: parsed.day_type,
          hours_worked: parsed.hours_worked,
          overtime_hours: parsed.overtime_hours,
          overtime_rate: parsed.overtime_rate,
          approved_by: parsed.approved_by,
        }),
      });

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Failed to save overtime entries.");
        return;
      }

      closeForm();
      await refreshEntries();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to save overtime entries.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitEdit(parsed: {
    date: string;
    day_type: OvertimeDayType;
    hours_worked: number;
    overtime_hours: number;
    overtime_rate: number;
    approved_by: string;
  }) {
    if (!editingId) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/hr-payroll/overtime-register", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          employee_id: form.employee_id,
          date: parsed.date,
          day_type: parsed.day_type,
          hours_worked: parsed.hours_worked,
          overtime_hours: parsed.overtime_hours,
          overtime_rate: parsed.overtime_rate,
          approved_by: parsed.approved_by,
        }),
      });

      const body = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Failed to update overtime entry.");
        return;
      }

      closeForm();
      await refreshEntries();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Failed to update overtime entry.",
      );
    } finally {
      setLoading(false);
    }
  }

  const confirmDateLabel = confirmBulk
    ? formatDate(confirmBulk.parsed.date)
    : "";
  const confirmAmountEach = confirmBulk
    ? calculateOvertimeAmount(
        confirmBulk.parsed.overtime_hours,
        confirmBulk.parsed.overtime_rate,
      )
    : 0;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Record overtime hours, rates, and approval for payroll processing.
        </p>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Entry"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Overtime Entry" : "New Overtime Entry"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  onBlur={() => handleFieldBlur("date")}
                  className={inputClassName}
                  aria-invalid={Boolean(fieldErrors.date)}
                />
                {fieldErrors.date ? (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {fieldErrors.date}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Day type
                </label>
                <select
                  required
                  value={form.day_type}
                  onChange={(e) =>
                    updateField(
                      "day_type",
                      e.target.value as OvertimeDayType,
                    )
                  }
                  onBlur={() => handleFieldBlur("day_type")}
                  className={inputClassName}
                  aria-invalid={Boolean(fieldErrors.day_type)}
                >
                  <option value={OVERTIME_DAY_TYPE_NORMAL}>
                    Normal working day
                  </option>
                  <option value={OVERTIME_DAY_TYPE_REST}>
                    Rest day / weekend / public holiday
                  </option>
                </select>
                {fieldErrors.day_type ? (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {fieldErrors.day_type}
                  </p>
                ) : null}
              </div>
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Employee
                  </label>
                  <select
                    required
                    value={form.employee_id}
                    onChange={(e) =>
                      updateField("employee_id", e.target.value)
                    }
                    className={inputClassName}
                  >
                    <option value="">Select employee</option>
                    {employees.map((employee) => (
                      <option
                        key={employee.employee_id}
                        value={employee.employee_id}
                      >
                        {employee.full_name}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.employee_ids ? (
                    <p className="mt-1 text-sm text-red-600" role="alert">
                      {fieldErrors.employee_ids}
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="md:col-span-2 xl:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Employees
                  </label>
                  <OvertimeEmployeeMultiSelect
                    employees={employees}
                    selectedIds={form.employee_ids}
                    onChange={(ids) => updateField("employee_ids", ids)}
                    disabled={loading}
                    error={fieldErrors.employee_ids ?? null}
                  />
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Hours Worked
                </label>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.01"
                  required
                  value={form.hours_worked}
                  onChange={(e) => updateField("hours_worked", e.target.value)}
                  onBlur={() => handleFieldBlur("hours_worked")}
                  className={inputClassName}
                  aria-invalid={Boolean(fieldErrors.hours_worked)}
                />
                {fieldErrors.hours_worked ? (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {fieldErrors.hours_worked}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Overtime Hours
                </label>
                <input
                  type="number"
                  min="0"
                  max="24"
                  step="0.01"
                  required
                  value={form.overtime_hours}
                  onChange={(e) =>
                    updateField("overtime_hours", e.target.value)
                  }
                  onBlur={() => handleFieldBlur("overtime_hours")}
                  className={inputClassName}
                  aria-invalid={Boolean(fieldErrors.overtime_hours)}
                />
                {fieldErrors.overtime_hours ? (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {fieldErrors.overtime_hours}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Overtime Rate
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.overtime_rate}
                  onChange={(e) => updateField("overtime_rate", e.target.value)}
                  onBlur={() => handleFieldBlur("overtime_rate")}
                  className={inputClassName}
                  aria-invalid={Boolean(fieldErrors.overtime_rate)}
                />
                {fieldErrors.overtime_rate ? (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {fieldErrors.overtime_rate}
                  </p>
                ) : null}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approved By
                </label>
                <select
                  required
                  value={form.approved_by}
                  onChange={(e) => updateField("approved_by", e.target.value)}
                  onBlur={() => handleFieldBlur("approved_by")}
                  className={inputClassName}
                  aria-invalid={Boolean(fieldErrors.approved_by)}
                >
                  <option value="">Select approver</option>
                  {approvers.map((approver) => (
                    <option key={approver.employee_id} value={approver.full_name}>
                      {approver.full_name}
                    </option>
                  ))}
                </select>
                {fieldErrors.approved_by ? (
                  <p className="mt-1 text-sm text-red-600" role="alert">
                    {fieldErrors.approved_by}
                  </p>
                ) : null}
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Overtime Amount:{" "}
              <span className="font-medium text-[#0f2744]">
                {previewOvertimeAmount == null
                  ? "—"
                  : formatGHS(previewOvertimeAmount)}
              </span>
              {previewOvertimeAmount != null &&
              !editingId &&
              form.employee_ids.length > 1 ? (
                <span>
                  {" "}
                  × {form.employee_ids.length} employees ={" "}
                  {formatGHS(previewOvertimeAmount * form.employee_ids.length)}
                </span>
              ) : null}
            </p>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingId
                    ? "Save Changes"
                    : "Add Entry"}
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
      )}

      {confirmBulk ? (
        <OvertimeBulkConfirmDialog
          dateLabel={confirmDateLabel}
          overtimeHours={confirmBulk.parsed.overtime_hours}
          overtimeRate={confirmBulk.parsed.overtime_rate}
          amountEach={confirmAmountEach}
          employees={confirmBulk.employees}
          confirming={loading}
          onCancel={() => {
            if (!loading) {
              setConfirmBulk(null);
            }
          }}
          onConfirm={(employeeIds) => {
            void submitBulk(employeeIds, confirmBulk.parsed);
          }}
        />
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Day type</th>
              <th className={scrollableTableThClassName}>Hours Worked</th>
              <th className={scrollableTableThClassName}>Overtime Hours</th>
              <th className={scrollableTableThClassName}>Overtime Rate</th>
              <th className={scrollableTableThClassName}>Overtime Amount</th>
              <th className={scrollableTableThClassName}>Approved By</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No overtime entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const overtimeAmount =
                  entry.overtime_amount ??
                  calculateOvertimeAmount(
                    entry.overtime_hours,
                    entry.overtime_rate,
                  );

                return (
                  <tr key={entry.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{formatDate(entry.date)}</td>
                    <td className="px-4 py-3">
                      {getEmployeeDisplayName(employees, entry.employee_id)}
                    </td>
                    <td className="px-4 py-3">
                      {displayOvertimeDayType(entry.day_type)}
                    </td>
                    <td className="px-4 py-3">{entry.hours_worked ?? "—"}</td>
                    <td className="px-4 py-3">{entry.overtime_hours}</td>
                    <td className="px-4 py-3">{formatGHS(entry.overtime_rate)}</td>
                    <td className="px-4 py-3">{formatGHS(overtimeAmount)}</td>
                    <td className="px-4 py-3">{entry.approved_by ?? "—"}</td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.id)}
                      deleting={deletingId === entry.id}
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
