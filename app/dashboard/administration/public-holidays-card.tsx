"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { useAlert, useConfirm, useToast } from "@/components/feedback/feedback-context";
import { inputClassName } from "../employees/employee-record-utils";

export type TenantHoliday = {
  id: string;
  holiday_date: string;
  name: string;
};

type PublicHolidaysCardProps = {
  tenantId: string | null;
  initialHolidays: TenantHoliday[];
  loadError: string | null;
};

function currentYear(): string {
  return String(new Date().getFullYear());
}

function dateKey(value: string): string {
  return value.slice(0, 10);
}

export default function PublicHolidaysCard({
  tenantId,
  initialHolidays,
  loadError,
}: PublicHolidaysCardProps) {
  const supabase = createClient();
  const { toast } = useToast();
  const { alertError } = useAlert();
  const confirm = useConfirm();
  const alertErrorRef = useRef(alertError);
  alertErrorRef.current = alertError;
  const [rows, setRows] = useState(initialHolidays);
  const [year, setYear] = useState(currentYear);
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loadError) {
      void alertErrorRef.current(loadError);
    }
  }, [loadError]);

  const years = useMemo(() => {
    const values = new Set<string>([currentYear()]);
    for (const row of rows) {
      const key = dateKey(row.holiday_date).slice(0, 4);
      if (key) {
        values.add(key);
      }
    }
    return [...values].sort((left, right) => right.localeCompare(left));
  }, [rows]);

  const visible = useMemo(
    () =>
      rows
        .filter((row) => dateKey(row.holiday_date).startsWith(`${year}-`))
        .sort((left, right) =>
          dateKey(left.holiday_date).localeCompare(dateKey(right.holiday_date)),
        ),
    [rows, year],
  );

  function duplicateDate(
    value: string,
    ignoreId: string | null,
    input: HTMLInputElement,
  ): boolean {
    const key = dateKey(value);
    const taken = rows.some(
      (row) => row.id !== ignoreId && dateKey(row.holiday_date) === key,
    );
    if (!taken) {
      input.setCustomValidity("");
      return false;
    }
    input.setCustomValidity("This date is already a public holiday.");
    input.reportValidity();
    return true;
  }

  async function saveHoliday(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const dateInput = form.elements.namedItem("holiday-date");
    const nameInput = form.elements.namedItem("holiday-name");
    if (
      !(dateInput instanceof HTMLInputElement) ||
      !(nameInput instanceof HTMLInputElement)
    ) {
      return;
    }
    dateInput.setCustomValidity("");
    nameInput.setCustomValidity("");
    if (!dateInput.value) {
      dateInput.setCustomValidity("Choose the holiday date.");
      dateInput.reportValidity();
      return;
    }
    if (!name.trim()) {
      nameInput.setCustomValidity("Enter the holiday name.");
      nameInput.reportValidity();
      return;
    }
    if (duplicateDate(dateInput.value, null, dateInput)) {
      return;
    }
    if (!tenantId) {
      await alertError(new Error("Could not resolve the workspace."));
      return;
    }

    setSaving(true);
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError) {
        throw new Error(userError.message);
      }
      const { data, error } = await supabase
        .from("tenant_holidays")
        .insert({
          tenant_id: tenantId,
          holiday_date: dateInput.value,
          name: name.trim(),
          created_by: userData.user?.id ?? null,
        })
        .select("id, holiday_date, name")
        .single();
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          dateInput.setCustomValidity("This date is already a public holiday.");
          dateInput.reportValidity();
          return;
        }
        throw new Error(error.message);
      }
      const created = data as TenantHoliday;
      setRows((current) => [...current, created]);
      setDate("");
      setName("");
      setYear(dateKey(created.holiday_date).slice(0, 4) || currentYear());
      toast("Holiday saved.");
    } catch (error) {
      await alertError(error);
    } finally {
      setSaving(false);
    }
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>, row: TenantHoliday) {
    event.preventDefault();
    const form = event.currentTarget;
    const dateInput = form.elements.namedItem(`edit-date-${row.id}`);
    const nameInput = form.elements.namedItem(`edit-name-${row.id}`);
    if (
      !(dateInput instanceof HTMLInputElement) ||
      !(nameInput instanceof HTMLInputElement)
    ) {
      return;
    }
    dateInput.setCustomValidity("");
    nameInput.setCustomValidity("");
    if (!editDate) {
      dateInput.setCustomValidity("Choose the holiday date.");
      dateInput.reportValidity();
      return;
    }
    if (!editName.trim()) {
      nameInput.setCustomValidity("Enter the holiday name.");
      nameInput.reportValidity();
      return;
    }
    if (duplicateDate(editDate, row.id, dateInput)) {
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from("tenant_holidays")
        .update({ holiday_date: editDate, name: editName.trim() })
        .eq("id", row.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          dateInput.setCustomValidity("This date is already a public holiday.");
          dateInput.reportValidity();
          return;
        }
        throw new Error(error.message);
      }
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? { ...item, holiday_date: editDate, name: editName.trim() }
            : item,
        ),
      );
      setEditingId(null);
      toast("Holiday saved.");
    } catch (error) {
      await alertError(error);
    } finally {
      setSaving(false);
    }
  }

  async function removeHoliday(row: TenantHoliday) {
    const accepted = await confirm({
      title: "Remove public holiday",
      message: `Remove ${row.name} on ${dateKey(row.holiday_date)}?`,
      confirmLabel: "Remove",
      destructive: true,
    });
    if (!accepted) {
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("tenant_holidays").delete().eq("id", row.id);
      if (error) {
        throw new Error(error.message);
      }
      setRows((current) => current.filter((item) => item.id !== row.id));
      if (editingId === row.id) {
        setEditingId(null);
      }
      toast("Holiday removed.");
    } catch (error) {
      await alertError(error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-lg font-semibold text-[#0f2744]">Public holidays</h3>
        <p className="mt-1 text-sm text-slate-600">
          A public holiday uses the weekend shift times, including when it falls
          on a weekday.
        </p>
      </div>
      <form onSubmit={(event) => void saveHoliday(event)} className="flex flex-wrap items-end gap-3">
        <label className="block text-sm font-medium text-slate-700">
          Date
          <input
            type="date"
            name="holiday-date"
            required
            value={date}
            onChange={(event) => {
              event.currentTarget.setCustomValidity("");
              setDate(event.target.value);
            }}
            className={`${inputClassName} mt-1`}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Name
          <input
            type="text"
            name="holiday-name"
            required
            value={name}
            onChange={(event) => {
              event.currentTarget.setCustomValidity("");
              setName(event.target.value);
            }}
            className={`${inputClassName} mt-1`}
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Add holiday"}
        </button>
      </form>
      <label className="block max-w-xs text-sm font-medium text-slate-700">
        Year
        <select
          value={year}
          onChange={(event) => setYear(event.target.value)}
          className={`${inputClassName} mt-1`}
        >
          {years.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">No public holidays for {year}.</p>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200">
          {visible.map((row) => (
            <li key={row.id} className="px-3 py-3 text-sm">
              {editingId === row.id ? (
                <form
                  onSubmit={(event) => void saveEdit(event, row)}
                  className="flex flex-wrap items-end gap-3"
                >
                  <input
                    type="date"
                    name={`edit-date-${row.id}`}
                    required
                    value={editDate}
                    onChange={(event) => {
                      event.currentTarget.setCustomValidity("");
                      setEditDate(event.target.value);
                    }}
                    className={inputClassName}
                  />
                  <input
                    type="text"
                    name={`edit-name-${row.id}`}
                    required
                    value={editName}
                    onChange={(event) => {
                      event.currentTarget.setCustomValidity("");
                      setEditName(event.target.value);
                    }}
                    className={inputClassName}
                  />
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-md bg-[#0f2744] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-medium text-[#0f2744]">
                      {dateKey(row.holiday_date)}
                    </span>
                    <span className="ml-3 text-slate-700">{row.name}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(row.id);
                        setEditDate(dateKey(row.holiday_date));
                        setEditName(row.name);
                      }}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => void removeHoliday(row)}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 disabled:opacity-50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
