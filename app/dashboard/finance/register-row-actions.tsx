type RegisterRowActionsProps = {
  onEdit: () => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onVoid?: () => void;
  deleting?: boolean;
  archiving?: boolean;
  voiding?: boolean;
  disableEdit?: boolean;
  disableDelete?: boolean;
  disableArchive?: boolean;
  disableVoid?: boolean;
  voidLabel?: string;
  archiveLabel?: string;
};

const editButtonClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

export function getStripedRowClassName(index: number): string {
  return index % 2 === 1 ? "bg-slate-50 text-slate-700" : "text-slate-700";
}

export function confirmDeleteEntry(): boolean {
  return window.confirm("Are you sure you want to delete this entry?");
}

export function confirmArchiveEntry(label: string): boolean {
  return window.confirm(
    `Archive this ${label}? It will be hidden from dropdowns for new transactions, but existing history stays visible.`,
  );
}

export function confirmRawMaterialPurchaseDelete(): boolean {
  return window.confirm(
    "Delete this purchase? Stock and average cost will be recalculated and any linked Cash or Accounts Payable posting will be reversed.",
  );
}

export function confirmRawMaterialPurchaseEdit(): boolean {
  return window.confirm(
    "Save changes to this purchase? Stock, average cost, and linked financial postings may be adjusted.",
  );
}

const voidButtonClassName =
  "rounded-md border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50";

const archiveButtonClassName =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function RegisterRowActions({
  onEdit,
  onDelete,
  onArchive,
  onVoid,
  deleting = false,
  archiving = false,
  voiding = false,
  disableEdit = false,
  disableDelete = false,
  disableArchive = false,
  disableVoid = false,
  voidLabel = "Void Sale",
  archiveLabel = "Archive",
}: RegisterRowActionsProps) {
  return (
    <td className="px-4 py-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={disableEdit}
          title={disableEdit ? "This entry cannot be edited" : undefined}
          className={editButtonClassName}
        >
          Edit
        </button>
        {onVoid ? (
          <button
            type="button"
            onClick={onVoid}
            disabled={voiding || disableVoid}
            title={disableVoid ? "This sale has already been voided" : undefined}
            className={voidButtonClassName}
          >
            {voiding ? "Voiding…" : voidLabel}
          </button>
        ) : onArchive ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={archiving || disableArchive}
            title={disableArchive ? "This entry is already archived" : undefined}
            className={archiveButtonClassName}
          >
            {archiving ? "Archiving…" : archiveLabel}
          </button>
        ) : onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting || disableDelete}
            title={disableDelete ? "This entry cannot be deleted" : undefined}
            className={deleteButtonClassName}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </div>
    </td>
  );
}
