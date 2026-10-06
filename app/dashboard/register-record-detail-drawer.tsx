"use client";

import { useEffect, type ReactNode } from "react";
import Tooltip from "@/components/ui/tooltip";
import { notifyRegisterDetailDrawerOpen } from "./register-detail-drawer-visibility";

export type RegisterDetailField = {
  label: string;
  value: ReactNode;
};

export type RegisterDetailSection = {
  title: string;
  fields: RegisterDetailField[];
};

type RegisterRecordDetailDrawerProps = {
  open: boolean;
  title: string;
  subtitle?: string | null;
  sections: RegisterDetailSection[];
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onEdit?: () => void;
  disableEdit?: boolean;
  editDisabledTitle?: string;
  footer?: ReactNode;
};

function RegisterDetailFieldRow({ label, value }: RegisterDetailField) {
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,9rem)_1fr] sm:gap-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="min-w-0 text-sm text-slate-900">{value ?? "—"}</dd>
    </div>
  );
}

export default function RegisterRecordDetailDrawer({
  open,
  title,
  subtitle,
  sections,
  loading = false,
  error = null,
  onClose,
  onEdit,
  disableEdit = false,
  editDisabledTitle,
  footer,
}: RegisterRecordDetailDrawerProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    notifyRegisterDetailDrawerOpen(true);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      notifyRegisterDetailDrawerOpen(false);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="presentation">
      <button
        type="button"
        aria-label="Close record details"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="register-record-detail-title"
        className="relative flex h-full w-full max-w-none flex-col bg-white shadow-2xl sm:max-w-md md:max-w-lg"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id="register-record-detail-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-1 truncate text-sm text-slate-600">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
          {loading ? (
            <p className="text-sm text-slate-600">Loading record…</p>
          ) : error ? (
            <p className="text-sm text-red-700">{error}</p>
          ) : (
            <div className="space-y-4">
              {sections.map((section) => (
                <section key={section.title} className="space-y-3">
                  <h3 className="text-sm font-semibold text-[#0f2744]">
                    {section.title}
                  </h3>
                  <dl className="space-y-3">
                    {section.fields.map((field) => (
                      <RegisterDetailFieldRow
                        key={`${section.title}-${field.label}`}
                        {...field}
                      />
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          )}
        </div>

        {footer ? (
          <footer className="shrink-0 border-t border-slate-200 px-4 py-4 sm:px-6">
            {footer}
          </footer>
        ) : onEdit ? (
          <footer className="flex shrink-0 justify-end gap-2 border-t border-slate-200 px-4 py-4 sm:px-6">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
            {disableEdit && editDisabledTitle ? (
              <Tooltip
                content={editDisabledTitle ?? "This entry cannot be edited"}
                variant="blocked"
              >
                <button
                  type="button"
                  disabled={disableEdit}
                  onClick={() => {
                    onClose();
                    onEdit();
                  }}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit
                </button>
              </Tooltip>
            ) : (
              <button
                type="button"
                disabled={disableEdit}
                onClick={() => {
                  onClose();
                  onEdit();
                }}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Edit
              </button>
            )}
          </footer>
        ) : null}
      </aside>
    </div>
  );
}
