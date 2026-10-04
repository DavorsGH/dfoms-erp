"use client";

import { useId, useRef, useState } from "react";
import { useDialogKeyboard } from "@/components/feedback/use-dialog-keyboard";
import { useFocusTrap } from "@/components/feedback/use-focus-trap";
import { formatGHS } from "./hr-register-utils";

export type OvertimeBulkConfirmEmployee = {
  employee_id: string;
  full_name: string;
  hasDuplicateOnDate: boolean;
};

type OvertimeBulkConfirmDialogProps = {
  dateLabel: string;
  overtimeHours: number;
  overtimeRate: number;
  amountEach: number;
  employees: OvertimeBulkConfirmEmployee[];
  onConfirm: (employeeIds: string[]) => void;
  onCancel: () => void;
  confirming?: boolean;
};

export default function OvertimeBulkConfirmDialog({
  dateLabel,
  overtimeHours,
  overtimeRate,
  amountEach,
  employees,
  onConfirm,
  onCancel,
  confirming = false,
}: OvertimeBulkConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  const [selectedIds, setSelectedIds] = useState(() =>
    employees.map((row) => row.employee_id),
  );

  useFocusTrap(true, panelRef);
  useDialogKeyboard(true, {
    onPrimary: () => {
      if (!confirming && selectedIds.length > 0) {
        onConfirm(selectedIds);
      }
    },
    onDismiss: onCancel,
  });

  const total = amountEach * selectedIds.length;

  function toggleEmployee(employeeId: string) {
    setSelectedIds((current) => {
      if (current.includes(employeeId)) {
        return current.filter((id) => id !== employeeId);
      }
      return [...current, employeeId];
    });
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h3 id={titleId} className="text-lg font-semibold text-[#0f2744]">
          Confirm overtime entry
        </h3>
        <p id={bodyId} className="mt-3 text-sm text-slate-700">
          Add overtime for {selectedIds.length} employee
          {selectedIds.length === 1 ? "" : "s"} on {dateLabel}: {overtimeHours}{" "}
          overtime hours each at {formatGHS(overtimeRate)}/hr = {formatGHS(amountEach)}{" "}
          each, {formatGHS(total)} total.
        </p>

        {employees.some((row) => row.hasDuplicateOnDate) ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Some employees already have overtime on this date. Untick them to
            skip, or keep them selected to add another entry.
          </div>
        ) : null}

        <ul className="mt-4 max-h-52 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2">
          {employees.map((employee) => {
            const checked = selectedIds.includes(employee.employee_id);
            return (
              <li key={employee.employee_id}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="mt-0.5 rounded border-slate-300"
                    checked={checked}
                    disabled={confirming}
                    onChange={() => toggleEmployee(employee.employee_id)}
                  />
                  <span>
                    <span className="font-medium text-slate-900">
                      {employee.full_name}
                    </span>
                    {employee.hasDuplicateOnDate ? (
                      <span className="mt-0.5 block text-xs text-amber-800">
                        already has overtime on this date
                      </span>
                    ) : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={confirming}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            disabled={confirming || selectedIds.length === 0}
            onClick={() => onConfirm(selectedIds)}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {confirming ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
