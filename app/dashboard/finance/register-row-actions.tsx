type RegisterRowActionsProps = {
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
};

const editButtonClassName =
  "rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export function toDateInputValue(value: string): string {
  return value.slice(0, 10);
}

export function confirmDeleteEntry(): boolean {
  return window.confirm("Are you sure you want to delete this entry?");
}

export default function RegisterRowActions({
  onEdit,
  onDelete,
  deleting = false,
}: RegisterRowActionsProps) {
  return (
    <td className="px-4 py-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onEdit}
          className={editButtonClassName}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className={deleteButtonClassName}
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </td>
  );
}
