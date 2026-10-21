"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import DashboardButton from "@/components/dashboard-button";
import { useAlert, useConfirm, useToast } from "@/components/feedback/feedback-context";
import { createClient } from "@/utils/supabase/client";
import {
  ARRANGEMENT_COLUMNS,
  arrangementFieldIssues,
  formatArrangementDateRange,
  formatWeekdays,
  ISO_WEEKDAYS,
  normalizeArrangementReason,
  normalizeWeekdays,
  validateArrangementOverlap,
  type ArrangementFieldIssue,
  type RemoteWorkArrangement,
} from "@/lib/attendance-mode";
import {
  REMOTE_LOCATION_OPTIONS,
  REMOTE_LOCATION_OTHER,
  todayInAccra,
} from "@/lib/attendance-requests/rules";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import {
  applyStaffIdScope,
  fetchScopedStaffIds,
  staffIdInActiveScope,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import { inputClassName } from "../employees/employee-record-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

const OUT_OF_SCOPE_STAFF_MESSAGE =
  "This staff member is outside the active business unit. Switch business unit or pick staff in this unit.";

export type ArrangementStaffOption = {
  staff_id: string;
  full_name: string;
};

type Props = {
  tenantId: string;
  /** Staff that can be chosen. One entry when the manager is locked to a staff member. */
  staff: ArrangementStaffOption[];
  initialArrangements: RemoteWorkArrangement[];
  /** super_admin, director, hr. Everyone else sees a read-only list. */
  canEdit: boolean;
  /** Employee record mode: only this staff member's arrangements. */
  lockedStaffId?: string;
  loadError?: string | null;
};

type Draft = {
  id: string | null;
  staff_id: string;
  weekdays: number[];
  start_date: string;
  end_date: string;
  location_choice: string;
  location_other: string;
  reason: string;
  auto_approve: boolean;
  is_active: boolean;
};

function emptyDraft(staffId: string): Draft {
  return {
    id: null,
    staff_id: staffId,
    weekdays: [],
    start_date: todayInAccra(),
    end_date: "",
    location_choice: "",
    location_other: "",
    reason: "",
    auto_approve: false,
    is_active: true,
  };
}

function draftFromArrangement(row: RemoteWorkArrangement): Draft {
  const preset = (REMOTE_LOCATION_OPTIONS as readonly string[]).includes(
    row.location_note,
  );
  return {
    id: row.id,
    staff_id: row.staff_id,
    weekdays: normalizeWeekdays(row.weekdays),
    start_date: row.start_date.slice(0, 10),
    end_date: row.end_date?.slice(0, 10) ?? "",
    location_choice: preset ? row.location_note : REMOTE_LOCATION_OTHER,
    location_other: preset ? "" : row.location_note,
    reason: row.reason,
    auto_approve: row.auto_approve,
    is_active: row.is_active,
  };
}

function sortArrangements(rows: RemoteWorkArrangement[]): RemoteWorkArrangement[] {
  return [...rows].sort(
    (a, b) =>
      a.staff_id.localeCompare(b.staff_id, undefined, { numeric: true }) ||
      b.start_date.localeCompare(a.start_date),
  );
}

export default function RemoteWorkArrangementsManager({
  tenantId,
  staff,
  initialArrangements,
  canEdit,
  lockedStaffId,
  loadError = null,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const buReadScope = useBusinessUnitReadScope();
  const { toast } = useToast();
  const { alert, alertError } = useAlert();
  const confirm = useConfirm();
  const weekdayRef = useRef<HTMLInputElement>(null);
  const locationRef = useRef<HTMLSelectElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState(() =>
    sortArrangements(
      initialArrangements.filter((row) => row.tenant_id === tenantId),
    ),
  );
  const [filterStaff, setFilterStaff] = useState(lockedStaffId ?? "");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);

  // Employee record mode loads its own rows so reopening a record is never stale.
  useEffect(() => {
    if (!lockedStaffId) {
      return;
    }
    let cancelled = false;
    void supabase
      .from("remote_work_arrangements")
      .select(ARRANGEMENT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("staff_id", lockedStaffId)
      .then(({ data, error }) => {
        if (cancelled) {
          return;
        }
        if (error) {
          setMountError(error.message);
          return;
        }
        setRows(sortArrangements((data ?? []) as RemoteWorkArrangement[]));
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, tenantId, lockedStaffId]);

  const staffName = useMemo(
    () => new Map(staff.map((entry) => [entry.staff_id, entry.full_name])),
    [staff],
  );
  const visibleRows = rows.filter(
    (row) => !filterStaff || row.staff_id === filterStaff,
  );

  function patchDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function toggleWeekday(value: number, checked: boolean) {
    weekdayRef.current?.setCustomValidity("");
    setDraft((current) => {
      if (!current) {
        return current;
      }
      const next = checked
        ? [...current.weekdays, value]
        : current.weekdays.filter((day) => day !== value);
      return { ...current, weekdays: normalizeWeekdays(next) };
    });
  }

  function locationFromDraft(current: Draft): string {
    return current.location_choice === REMOTE_LOCATION_OTHER
      ? current.location_other.trim()
      : current.location_choice.trim();
  }

  /** Native validation bubble on the offending field. Returns true when shown. */
  function showIssue(issue: ArrangementFieldIssue | undefined): boolean {
    if (!issue) {
      return false;
    }
    const field =
      issue.field === "weekdays"
        ? weekdayRef.current
        : issue.field === "start_date"
          ? startRef.current
          : issue.field === "end_date"
            ? endRef.current
            : issue.field === "reason"
              ? reasonRef.current
              : draft?.location_choice === REMOTE_LOCATION_OTHER
                ? otherRef.current
                : locationRef.current;
    if (!field) {
      return false;
    }
    field.setCustomValidity(issue.message);
    field.reportValidity();
    return true;
  }

  function clearValidity() {
    for (const ref of [weekdayRef, locationRef, otherRef, startRef, endRef, reasonRef]) {
      ref.current?.setCustomValidity("");
    }
  }

  async function currentUserId(): Promise<string | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.id ?? null;
  }

  async function assertStaffInActiveScope(staffId: string): Promise<void> {
    if (lockedStaffId) {
      return;
    }
    const scoped = await fetchScopedStaffIds(supabase, tenantId, buReadScope);
    if (scoped.error) {
      throw new Error(scoped.error);
    }
    if (!staffIdInActiveScope(staffId, scoped.staffIds)) {
      throw new Error(OUT_OF_SCOPE_STAFF_MESSAGE);
    }
  }

  /** Fresh active rows for this tenant + staff, so a stale list cannot miss a clash. */
  async function loadActiveForStaff(staffId: string): Promise<RemoteWorkArrangement[]> {
    const { data, error } = await supabase
      .from("remote_work_arrangements")
      .select(ARRANGEMENT_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("staff_id", staffId)
      .eq("is_active", true);
    if (error) {
      throw new Error(error.message);
    }
    return (data ?? []) as RemoteWorkArrangement[];
  }

  async function refreshRows() {
    if (lockedStaffId) {
      const { data, error } = await supabase
        .from("remote_work_arrangements")
        .select(ARRANGEMENT_COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("staff_id", lockedStaffId);
      if (error) {
        throw new Error(error.message);
      }
      setRows(sortArrangements((data ?? []) as RemoteWorkArrangement[]));
      return;
    }

    const scoped = await fetchScopedStaffIds(supabase, tenantId, buReadScope);
    if (scoped.error) {
      throw new Error(scoped.error);
    }
    const { data, error } = await applyStaffIdScope(
      supabase
        .from("remote_work_arrangements")
        .select(ARRANGEMENT_COLUMNS)
        .eq("tenant_id", tenantId),
      scoped.staffIds,
    );
    if (error) {
      throw new Error(error.message);
    }
    setRows(sortArrangements((data ?? []) as RemoteWorkArrangement[]));
  }

  async function refuseIfOverlap(candidate: {
    id: string | null;
    staff_id: string;
    weekdays: number[];
    start_date: string;
    end_date: string | null;
    is_active: boolean;
  }): Promise<boolean> {
    const existing = await loadActiveForStaff(candidate.staff_id);
    const result = validateArrangementOverlap(existing, {
      ...candidate,
      tenant_id: tenantId,
    });
    if (result.ok) {
      return false;
    }
    await alert({
      title: "Overlapping arrangement",
      message: result.message,
      variant: "warning",
    });
    return true;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) {
      return;
    }
    clearValidity();
    const location = locationFromDraft(draft);
    const issue = arrangementFieldIssues({
      weekdays: draft.weekdays,
      start_date: draft.start_date,
      end_date: draft.end_date || null,
      location_note: location,
      reason: draft.reason,
    })[0];
    if (showIssue(issue)) {
      return;
    }

    setSaving(true);
    try {
      await assertStaffInActiveScope(draft.staff_id);
      const weekdays = normalizeWeekdays(draft.weekdays);
      const endDate = draft.end_date || null;
      if (
        await refuseIfOverlap({
          id: draft.id,
          staff_id: draft.staff_id,
          weekdays,
          start_date: draft.start_date,
          end_date: endDate,
          is_active: draft.is_active,
        })
      ) {
        return;
      }

      const userId = await currentUserId();
      const values = {
        weekdays,
        start_date: draft.start_date,
        end_date: endDate,
        location_note: location,
        reason: normalizeArrangementReason(draft.reason),
        auto_approve: draft.auto_approve,
        is_active: draft.is_active,
        approved_by: userId,
      };
      if (draft.id) {
        const { error } = await supabase
          .from("remote_work_arrangements")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("id", draft.id);
        if (error) {
          throw new Error(error.message);
        }
      } else {
        const { error } = await supabase.from("remote_work_arrangements").insert({
          ...values,
          tenant_id: tenantId,
          staff_id: draft.staff_id,
          created_by: userId,
        });
        if (error) {
          throw new Error(error.message);
        }
      }
      await refreshRows();
      setDraft(null);
      toast("Remote work arrangement saved");
    } catch (saveError) {
      await alertError(saveError);
    } finally {
      setSaving(false);
    }
  }

  async function setActive(row: RemoteWorkArrangement, active: boolean) {
    if (!active) {
      const ok = await confirm({
        title: "Deactivate arrangement",
        message: `Deactivate the ${formatWeekdays(row.weekdays)} remote work arrangement for ${staffName.get(row.staff_id) ?? row.staff_id}? Past attendance is not changed.`,
        confirmLabel: "Deactivate",
        destructive: true,
      });
      if (!ok) {
        return;
      }
    }
    setSaving(true);
    try {
      await assertStaffInActiveScope(row.staff_id);
      if (
        active &&
        (await refuseIfOverlap({
          id: row.id,
          staff_id: row.staff_id,
          weekdays: row.weekdays,
          start_date: row.start_date,
          end_date: row.end_date,
          is_active: true,
        }))
      ) {
        return;
      }
      const { error } = await supabase
        .from("remote_work_arrangements")
        .update({ is_active: active, updated_at: new Date().toISOString() })
        .eq("tenant_id", tenantId)
        .eq("id", row.id);
      if (error) {
        throw new Error(error.message);
      }
      await refreshRows();
      toast(active ? "Arrangement activated" : "Arrangement deactivated");
    } catch (updateError) {
      await alertError(updateError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4">
      {loadError || mountError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {loadError ?? mountError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        {lockedStaffId ? (
          <p className="text-sm text-slate-600">
            Days this person may work remotely. An auto-approve arrangement
            approves their remote clock-in without an approver.
          </p>
        ) : (
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">
              Filter by staff
            </span>
            <select
              className={`${inputClassName} min-w-64`}
              value={filterStaff}
              onChange={(event) => setFilterStaff(event.target.value)}
            >
              <option value="">All staff</option>
              {staff.map((entry) => (
                <option key={entry.staff_id} value={entry.staff_id}>
                  {entry.staff_id} — {entry.full_name}
                </option>
              ))}
            </select>
          </label>
        )}
        {canEdit && !draft ? (
          <DashboardButton
            type="button"
            onClick={() => setDraft(emptyDraft(lockedStaffId ?? filterStaff))}
          >
            Add arrangement
          </DashboardButton>
        ) : null}
      </div>

      {draft && canEdit ? (
        <form
          className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
          onSubmit={(event) => void save(event)}
        >
          <h4 className="text-sm font-semibold text-[#0f2744]">
            {draft.id ? "Edit arrangement" : "New arrangement"}
          </h4>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {!lockedStaffId ? (
              <label className="block text-sm md:col-span-2">
                <span className="mb-1 block font-medium text-slate-700">Staff</span>
                <select
                  required
                  disabled={Boolean(draft.id)}
                  className={inputClassName}
                  value={draft.staff_id}
                  onChange={(event) => patchDraft({ staff_id: event.target.value })}
                >
                  <option value="">Select staff</option>
                  {staff.map((entry) => (
                    <option key={entry.staff_id} value={entry.staff_id}>
                      {entry.staff_id} — {entry.full_name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <fieldset className="md:col-span-2">
              <legend className="mb-1 block text-sm font-medium text-slate-700">
                Days
              </legend>
              <div className="flex flex-wrap gap-3">
                {ISO_WEEKDAYS.map((day, index) => (
                  <label
                    key={day.value}
                    className="flex items-center gap-2 text-sm text-slate-700"
                  >
                    <input
                      ref={index === 0 ? weekdayRef : undefined}
                      type="checkbox"
                      checked={draft.weekdays.includes(day.value)}
                      onChange={(event) =>
                        toggleWeekday(day.value, event.target.checked)
                      }
                    />
                    {day.short}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Start date
              </span>
              <input
                ref={startRef}
                required
                type="date"
                className={inputClassName}
                value={draft.start_date}
                onChange={(event) => {
                  event.target.setCustomValidity("");
                  patchDraft({ start_date: event.target.value });
                }}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                End date (optional)
              </span>
              <input
                ref={endRef}
                type="date"
                className={inputClassName}
                value={draft.end_date}
                min={draft.start_date || undefined}
                onChange={(event) => {
                  event.target.setCustomValidity("");
                  patchDraft({ end_date: event.target.value });
                }}
              />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Location</span>
              <select
                ref={locationRef}
                required
                className={inputClassName}
                value={draft.location_choice}
                onChange={(event) => {
                  event.target.setCustomValidity("");
                  patchDraft({ location_choice: event.target.value });
                }}
              >
                <option value="">Select location</option>
                {REMOTE_LOCATION_OPTIONS.map((place) => (
                  <option key={place} value={place}>
                    {place}
                  </option>
                ))}
                <option value={REMOTE_LOCATION_OTHER}>{REMOTE_LOCATION_OTHER}</option>
              </select>
              {draft.location_choice === REMOTE_LOCATION_OTHER ? (
                <input
                  ref={otherRef}
                  required
                  className={`${inputClassName} mt-2`}
                  value={draft.location_other}
                  placeholder="Where will they work?"
                  onChange={(event) => {
                    event.target.setCustomValidity("");
                    patchDraft({ location_other: event.target.value });
                  }}
                />
              ) : null}
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">
                Reason (optional)
              </span>
              <input
                ref={reasonRef}
                className={inputClassName}
                value={draft.reason}
                placeholder="Remote work arrangement"
                onChange={(event) => {
                  event.target.setCustomValidity("");
                  patchDraft({ reason: event.target.value });
                }}
              />
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.auto_approve}
                onChange={(event) => patchDraft({ auto_approve: event.target.checked })}
              />
              Auto-approve remote clock-ins on these days
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => patchDraft({ is_active: event.target.checked })}
              />
              Active
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <DashboardButton type="submit" disabled={saving}>
              {draft.id ? "Save changes" : "Add arrangement"}
            </DashboardButton>
            <DashboardButton
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => {
                clearValidity();
                setDraft(null);
              }}
            >
              Cancel
            </DashboardButton>
          </div>
        </form>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              {!lockedStaffId ? (
                <th className={scrollableTableThClassName}>Staff</th>
              ) : null}
              <th className={scrollableTableThClassName}>Days</th>
              <th className={scrollableTableThClassName}>Dates</th>
              <th className={scrollableTableThClassName}>Location</th>
              <th className={scrollableTableThClassName}>Auto-approve</th>
              <th className={scrollableTableThClassName}>Status</th>
              {canEdit ? <th className={scrollableTableThClassName}> </th> : null}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={(lockedStaffId ? 5 : 6) + (canEdit ? 1 : 0)}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  No remote work arrangements yet.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  {!lockedStaffId ? (
                    <td className="px-2 py-2">
                      {row.staff_id} — {staffName.get(row.staff_id) ?? "Unknown"}
                    </td>
                  ) : null}
                  <td className="px-2 py-2">{formatWeekdays(row.weekdays)}</td>
                  <td className="px-2 py-2">
                    {formatArrangementDateRange(row.start_date, row.end_date)}
                  </td>
                  <td className="px-2 py-2">{row.location_note}</td>
                  <td className="px-2 py-2">{row.auto_approve ? "Yes" : "No"}</td>
                  <td className="px-2 py-2">
                    {row.is_active ? "Active" : "Inactive"}
                  </td>
                  {canEdit ? (
                    <td className="px-2 py-2 whitespace-nowrap">
                      <button
                        type="button"
                        className="mr-3 text-[#0f2744] underline"
                        disabled={saving}
                        onClick={() => setDraft(draftFromArrangement(row))}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={`underline ${row.is_active ? "text-red-700" : "text-emerald-700"}`}
                        disabled={saving}
                        onClick={() => void setActive(row, !row.is_active)}
                      >
                        {row.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
