type EmployeeRowActionsProps = {
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
};

const buttonClassName =
  "rounded-md border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export default function EmployeeRowActions({
  onView,
  onEdit,
  onDelete,
  deleting = false,
  canEdit = true,
  canDelete = true,
}: EmployeeRowActionsProps) {
  return (
    <td
      className="px-4 py-3"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onView}
          className={`${buttonClassName} border-slate-200 text-slate-700 hover:bg-slate-50`}
        >
          View
        </button>
        {canEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className={`${buttonClassName} border-slate-200 text-slate-700 hover:bg-slate-50`}
          >
            Edit
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className={`${buttonClassName} border-red-200 text-red-700 hover:bg-red-50`}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </div>
    </td>
  );
}
