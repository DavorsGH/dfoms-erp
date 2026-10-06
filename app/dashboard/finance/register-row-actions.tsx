import { confirmDialog } from "@/components/feedback/app-dialogs";
import Tooltip from "@/components/ui/tooltip";
import type { ReactNode } from "react";
import {
  scrollableTableActionsCellClassName,
  scrollableTableCompactCellClassName,
} from "../scrollable-table";

export const registerTableActionsInnerClassName =
  "inline-flex flex-nowrap items-center gap-2";

/** Scroll to a register row and briefly ring-highlight (deep links from 360 views). */
export function highlightRegisterTableRow(rowElementId: string): boolean {
  const row = document.getElementById(rowElementId);
  if (!row) {
    return false;
  }
  row.scrollIntoView({ behavior: "smooth", block: "center" });
  row.classList.add("ring-2", "ring-[#0f2744]");
  window.setTimeout(() => {
    row.classList.remove("ring-2", "ring-[#0f2744]");
  }, 2500);
  return true;
}

type RegisterRowActionsProps = {
  onEdit?: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onRestore?: () => void;
  onVoid?: () => void;
  onPrint?: () => void;
  onMarkPaid?: () => void;
  onRecordPayment?: () => void;
  deleting?: boolean;
  archiving?: boolean;
  restoring?: boolean;
  voiding?: boolean;
  markingPaid?: boolean;
  recordingPayment?: boolean;
  printing?: boolean;
  disableEdit?: boolean;
  disableDelete?: boolean;
  editDisabledTitle?: string;
  deleteDisabledTitle?: string;
  disableArchive?: boolean;
  disableVoid?: boolean;
  voidDisabledTitle?: string;
  onReturn?: () => void;
  disableReturn?: boolean;
  returnDisabledTitle?: string;
  returning?: boolean;
  voidLabel?: string;
  returnLabel?: string;
  archiveLabel?: string;
  restoreLabel?: string;
  printLabel?: string;
  markPaidLabel?: string;
  recordPaymentLabel?: string;
  compact?: boolean;
  disableRecordPayment?: boolean;
  recordPaymentDisabledTitle?: string;
};

const editButtonClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const editButtonCompactClassName =
  "rounded border border-slate-200 px-1.5 py-0.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const markPaidButtonClassName =
  "rounded-md border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50";

const markPaidButtonCompactClassName =
  "rounded border border-emerald-200 px-1.5 py-0.5 text-xs font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function withDisabledActionTooltip(
  disabled: boolean,
  tooltip: string | undefined,
  node: ReactNode,
) {
  if (disabled && tooltip?.trim()) {
    return (
      <Tooltip content={tooltip} variant="blocked">
        {node}
      </Tooltip>
    );
  }
  return node;
}

export function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

export function getStripedRowClassName(index: number): string {
  return index % 2 === 1 ? "bg-slate-50 text-slate-900" : "text-slate-900";
}

export async function confirmDeleteEntry(): Promise<boolean> {
  return confirmDialog({
    message: "Are you sure you want to delete this entry?",
    tone: "danger",
    confirmLabel: "Delete",
  });
}

export async function confirmArchiveEntry(label: string): Promise<boolean> {
  return confirmDialog({
    message: `Archive this ${label}? It will be hidden from dropdowns for new transactions, but existing history stays visible.`,
    confirmLabel: "Archive",
  });
}

export async function confirmReactivateEntry(label: string): Promise<boolean> {
  return confirmDialog({
    message: `Reactivate this ${label}? It will appear again in dropdowns for new transactions.`,
    confirmLabel: "Reactivate",
  });
}

export async function confirmRawMaterialPurchaseDelete(): Promise<boolean> {
  return confirmDialog({
    message:
      "Delete this purchase? Stock and average cost will be recalculated and any linked Cash or Accounts Payable posting will be reversed.",
    tone: "danger",
    confirmLabel: "Delete",
  });
}

export async function confirmRawMaterialPurchaseEdit(): Promise<boolean> {
  return confirmDialog({
    message:
      "Save changes to this purchase? Stock, average cost, and linked financial postings may be adjusted.",
    confirmLabel: "Save",
  });
}

export async function confirmProductPurchaseEdit(): Promise<boolean> {
  return confirmDialog({
    message:
      "Save changes to this purchase? Stock, average cost, and linked financial postings may be adjusted.",
    confirmLabel: "Save",
  });
}

export const reversalActionButtonClassName =
  "rounded-md border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50";

const voidButtonCompactClassName =
  "rounded border border-amber-200 px-1.5 py-0.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50";

const voidButtonClassName = reversalActionButtonClassName;

const archiveButtonClassName =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const restoreButtonClassName =
  "rounded-md border border-emerald-200 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function RegisterRowActions({
  onEdit,
  onDelete,
  onArchive,
  onRestore,
  onVoid,
  onPrint,
  onMarkPaid,
  onRecordPayment,
  deleting = false,
  archiving = false,
  restoring = false,
  voiding = false,
  markingPaid = false,
  recordingPayment = false,
  printing = false,
  disableEdit = false,
  disableDelete = false,
  editDisabledTitle,
  deleteDisabledTitle,
  disableArchive = false,
  disableVoid = false,
  voidDisabledTitle,
  onReturn,
  disableReturn = false,
  returnDisabledTitle,
  returning = false,
  voidLabel = "Void Sale",
  returnLabel = "Return",
  archiveLabel = "Archive",
  restoreLabel = "Reactivate",
  printLabel = "Print Receipt",
  markPaidLabel = "Mark as Paid",
  recordPaymentLabel = "Record Payment",
  compact = false,
  disableRecordPayment = false,
  recordPaymentDisabledTitle,
}: RegisterRowActionsProps) {
  const printClass = compact ? editButtonCompactClassName : editButtonClassName;
  const payClass = compact ? markPaidButtonCompactClassName : markPaidButtonClassName;
  const voidClass = compact ? voidButtonCompactClassName : voidButtonClassName;
  const resolvedPrintLabel = compact ? "Print" : printLabel;
  const resolvedPayLabel = compact ? "Pay" : recordPaymentLabel;
  const resolvedVoidLabel = compact ? "Void" : voidLabel;
  const resolvedReturnLabel = compact ? "Return" : returnLabel;

  return (
    <td
      className={
        compact
          ? `px-2 py-2 whitespace-nowrap ${scrollableTableCompactCellClassName} ${scrollableTableActionsCellClassName}`
          : `px-4 py-3 whitespace-nowrap ${scrollableTableCompactCellClassName} ${scrollableTableActionsCellClassName}`
      }
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className={`${registerTableActionsInnerClassName} ${compact ? "gap-1" : ""}`}
      >
        {onPrint ? (
          <button
            type="button"
            onClick={onPrint}
            disabled={printing}
            className={printClass}
          >
            {printing ? "…" : resolvedPrintLabel}
          </button>
        ) : null}
        {onRecordPayment
          ? withDisabledActionTooltip(
              Boolean(recordingPayment || disableRecordPayment),
              disableRecordPayment
                ? (recordPaymentDisabledTitle ?? "Record payment is not available")
                : undefined,
              <button
                type="button"
                onClick={onRecordPayment}
                disabled={recordingPayment || disableRecordPayment}
                className={payClass}
              >
                {recordingPayment ? "…" : resolvedPayLabel}
              </button>,
            )
          : null}
        {onMarkPaid ? (
          <button
            type="button"
            onClick={onMarkPaid}
            disabled={markingPaid}
            className={markPaidButtonClassName}
          >
            {markingPaid ? "Marking…" : markPaidLabel}
          </button>
        ) : null}
        {onEdit
          ? withDisabledActionTooltip(
              disableEdit,
              disableEdit
                ? (editDisabledTitle ?? "This entry cannot be edited")
                : undefined,
              <button
                type="button"
                onClick={onEdit}
                disabled={disableEdit}
                className={editButtonClassName}
              >
                Edit
              </button>,
            )
          : null}
        {onReturn
          ? withDisabledActionTooltip(
              Boolean(returning || disableReturn),
              disableReturn
                ? (returnDisabledTitle ?? "Return is not available for this row")
                : undefined,
              <button
                type="button"
                onClick={onReturn}
                disabled={returning || disableReturn}
                className={voidClass}
              >
            <span className={`inline-flex items-center ${compact ? "gap-0.5" : "gap-1.5"}`}>
              {!compact ? (
                <svg
                  aria-hidden
                  className="h-4 w-4 shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M9 14 4 9l5-5" />
                  <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
                </svg>
              ) : null}
              {returning ? "…" : resolvedReturnLabel}
            </span>
              </button>,
            )
          : null}
        {onVoid
          ? withDisabledActionTooltip(
              Boolean(voiding || disableVoid),
              disableVoid
                ? (voidDisabledTitle ?? "This sale has already been voided")
                : undefined,
              <button
                type="button"
                onClick={onVoid}
                disabled={voiding || disableVoid}
                className={voidClass}
              >
                {voiding ? "…" : resolvedVoidLabel}
              </button>,
            )
          : onRestore ? (
          <button
            type="button"
            onClick={onRestore}
            disabled={restoring}
            className={restoreButtonClassName}
          >
            {restoring ? "Reactivating…" : restoreLabel}
          </button>
        ) : onArchive ? (
          withDisabledActionTooltip(
            Boolean(archiving || disableArchive),
            disableArchive ? "This entry is already archived" : undefined,
            <button
              type="button"
              onClick={onArchive}
              disabled={archiving || disableArchive}
              className={archiveButtonClassName}
            >
              {archiving ? "Archiving…" : archiveLabel}
            </button>,
          )
        ) : onDelete ? (
          withDisabledActionTooltip(
            Boolean(deleting || disableDelete),
            disableDelete
              ? (deleteDisabledTitle ?? "This entry cannot be deleted")
              : undefined,
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting || disableDelete}
              className={deleteButtonClassName}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>,
          )
        ) : null}
      </div>
    </td>
  );
}
