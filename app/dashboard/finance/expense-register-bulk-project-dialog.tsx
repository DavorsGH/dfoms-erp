"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useDialogKeyboard } from "@/components/feedback/use-dialog-keyboard";
import { useFocusTrap } from "@/components/feedback/use-focus-trap";
import type { ContractProjectOption } from "../administration/projects-utils";
import {
  EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE,
  expenseRegisterInputClassName,
  expenseRegisterProjectOptionsForForm,
  formatExpenseRegisterContractProjectLabel,
  formatGHS,
  resolveExpenseRegisterProjectIdForSave,
} from "./expense-register-utils";

type ExpenseRegisterBulkProjectDialogProps = {
  open: boolean;
  selectedCount: number;
  selectedTotal: number;
  projects: ContractProjectOption[];
  hasActiveProjects: boolean;
  assigning: boolean;
  onCancel: () => void;
  onAssign: (projectFormValue: string) => void;
};

export default function ExpenseRegisterBulkProjectDialog({
  open,
  selectedCount,
  selectedTotal,
  projects,
  hasActiveProjects,
  assigning,
  onCancel,
  onAssign,
}: ExpenseRegisterBulkProjectDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const projectSelectRef = useRef<HTMLSelectElement>(null);

  function validateProjectChoice(): boolean {
    const select = projectSelectRef.current;
    if (!hasActiveProjects) {
      return true;
    }
    const result = resolveExpenseRegisterProjectIdForSave(projectFormValue, true);
    if (!result.ok) {
      if (select) {
        select.setCustomValidity(result.error);
        select.reportValidity();
      }
      return false;
    }
    select?.setCustomValidity("");
    return true;
  }

  const [projectFormValue, setProjectFormValue] = useState(
    EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE,
  );
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirming(false);
      setProjectFormValue(EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE);
      projectSelectRef.current?.setCustomValidity("");
    }
  }, [open]);

  useFocusTrap(open, panelRef);
  useDialogKeyboard(open, {
    onPrimary: () => {
      if (assigning) {
        return;
      }
      if (!confirming) {
        if (!validateProjectChoice()) {
          return;
        }
        setConfirming(true);
        return;
      }
      onAssign(projectFormValue);
    },
    onDismiss: () => {
      if (confirming && !assigning) {
        setConfirming(false);
        return;
      }
      onCancel();
    },
  });

  if (!open) {
    return null;
  }

  const projectOptions = expenseRegisterProjectOptionsForForm(
    projects,
    projectFormValue,
  );

  const assignLabel = formatExpenseRegisterContractProjectLabel(
    projectFormValue === EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE
      ? null
      : projectFormValue,
    projects,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !assigning) {
          onCancel();
        }
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold text-[#0f2744]">
          Assign Contract / Project
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-slate-600">
          {confirming ? (
            <>
              Assign {selectedCount} expense{selectedCount === 1 ? "" : "s"} (
              {formatGHS(selectedTotal)}) to{" "}
              <span className="font-medium text-[#0f2744]">{assignLabel}</span>?
            </>
          ) : (
            <>
              Choose a contract or project for {selectedCount} selected expense
              {selectedCount === 1 ? "" : "s"} ({formatGHS(selectedTotal)} total).
            </>
          )}
        </p>

        {!confirming && hasActiveProjects ? (
          <div className="mt-4">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Contract / Project
            </label>
            <select
              ref={projectSelectRef}
              required
              value={projectFormValue}
              onChange={(event) => {
                setProjectFormValue(event.target.value);
                projectSelectRef.current?.setCustomValidity("");
              }}
              className={expenseRegisterInputClassName()}
            >
              <option value="">Select contract or project…</option>
              <option value={EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE}>
                Company overhead (not tied to a contract)
              </option>
              {projectOptions.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.project_code} — {project.project_name}
                  {project.is_archived ? " (Inactive)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!confirming && !hasActiveProjects ? (
          <p className="mt-4 text-sm text-slate-600">
            No active projects — assignment will set Company overhead.
          </p>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            disabled={assigning}
            onClick={() => {
              if (confirming && !assigning) {
                setConfirming(false);
                return;
              }
              onCancel();
            }}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={assigning}
            onClick={() => {
              if (!confirming) {
                if (!validateProjectChoice()) {
                  return;
                }
                setConfirming(true);
                return;
              }
              onAssign(
                hasActiveProjects
                  ? projectFormValue
                  : EXPENSE_REGISTER_PROJECT_OVERHEAD_VALUE,
              );
            }}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
          >
            {assigning ? "Assigning…" : confirming ? "Assign" : "Continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
