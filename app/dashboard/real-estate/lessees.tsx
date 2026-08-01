"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow } from "./landlords-utils";
import {
  LESSEE_STATUS_OPTIONS,
  formatLesseeDate,
  formatLesseeStatus,
  type LesseeListRow,
  type LesseeStatus,
} from "./lessees-utils";

type LesseesProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  initialRows: LesseeListRow[];
  landlordsError: string | null;
  lesseesError: string | null;
};

const emptyForm = {
  full_name: "",
  phone: "",
  email: "",
  status: "active" as LesseeStatus,
  private_notes: "",
};

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function Lessees({
  landlords,
  selectedLandlordId,
  initialRows,
  landlordsError,
  lesseesError,
}: LesseesProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? lesseesError,
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(landlordsError ?? lesseesError);
  }, [landlordsError, lesseesError]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );

  function handleLandlordChange(tenantId: string) {
    setShowForm(false);
    setEditingId(null);
    setExpandedId(null);
    setForm(emptyForm);
    if (!tenantId) {
      router.push("/dashboard/real-estate/lessees");
      return;
    }
    router.push(
      `/dashboard/real-estate/lessees?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  function openAddForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function openEditForm(row: LesseeListRow) {
    setEditingId(row.lesseeId);
    setForm({
      full_name: row.fullName,
      phone: row.phone,
      email: row.email ?? "",
      status: row.status,
      private_notes: row.privateNotes ?? "",
    });
    setShowForm(true);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId) {
      return;
    }

    setLoading(true);
    setError(null);

    const endpoint = editingId
      ? "/api/admin/lessees/update"
      : "/api/admin/lessees/create";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        lessee_id: editingId,
        full_name: form.full_name,
        phone: form.phone,
        email: form.email || null,
        status: form.status,
        private_notes: form.private_notes || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save tenant.");
      setLoading(false);
      return;
    }

    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label
          htmlFor="lessees-landlord-picker"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Landlord
        </label>
        <select
          id="lessees-landlord-picker"
          value={selectedLandlordId ?? ""}
          onChange={(event) => handleLandlordChange(event.target.value)}
          className={inputClassName}
        >
          <option value="">Select a landlord</option>
          {landlords.map((landlord) => (
            <option key={landlord.tenantId} value={landlord.tenantId}>
              {landlord.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!selectedLandlordId ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">
            Select a landlord to view and manage their tenants.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Managing tenants for{" "}
              <span className="font-medium text-[#0f2744]">
                {selectedLandlord?.name ?? "selected landlord"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                if (showForm && !editingId) {
                  setShowForm(false);
                  setForm(emptyForm);
                } else {
                  openAddForm();
                }
              }}
              className={primaryButtonClassName}
            >
              {showForm && !editingId ? "Cancel" : "Add Tenant"}
            </button>
          </div>

          {showForm ? (
            <form
              onSubmit={handleSave}
              className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
                {editingId ? "Edit Tenant" : "New Tenant"}
              </h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Full Name
                  </label>
                  <input
                    required
                    type="text"
                    value={form.full_name}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        full_name: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Phone
                  </label>
                  <input
                    required
                    type="text"
                    value={form.phone}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        phone: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Email
                  </label>
                  <input
                    type="email"
                    value={form.email}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Status
                  </label>
                  <select
                    value={form.status}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        status: event.target.value as LesseeStatus,
                      }))
                    }
                    className={inputClassName}
                  >
                    {LESSEE_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Private / Internal Notes
                </label>
                <p className="mb-1 text-xs text-slate-500">
                  Internal only — never shown to the tenant.
                </p>
                <textarea
                  rows={3}
                  value={form.private_notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      private_notes: event.target.value,
                    }))
                  }
                  className={textareaClassName}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={primaryButtonClassName}
                >
                  {loading ? "Saving…" : "Save Tenant"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditingId(null);
                    setForm(emptyForm);
                  }}
                  className={secondaryButtonClassName}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Full Name</th>
                  <th className={scrollableTableThClassName}>Phone</th>
                  <th className={scrollableTableThClassName}>Email</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Created Date</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No tenants yet for this landlord.
                    </td>
                  </tr>
                ) : (
                  rows.flatMap((row, index) => {
                    const mainRow = (
                      <tr
                        key={row.lesseeId}
                        className={getStripedRowClassName(index)}
                      >
                        <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                          <Link
                            href={`/dashboard/real-estate/lessees/${row.tenantId}/${row.lesseeId}`}
                            className="hover:underline"
                          >
                            {row.fullName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {row.phone}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {row.email ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatLesseeStatus(row.status)}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatLesseeDate(row.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          <div className="flex flex-wrap gap-3">
                            <Link
                              href={`/dashboard/real-estate/lessees/${row.tenantId}/${row.lesseeId}`}
                              className="text-[#0f2744] hover:underline"
                            >
                              View
                            </Link>
                            <button
                              type="button"
                              onClick={() => openEditForm(row)}
                              className="text-[#0f2744] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedId((current) =>
                                  current === row.lesseeId
                                    ? null
                                    : row.lesseeId,
                                )
                              }
                              className="text-[#0f2744] hover:underline"
                            >
                              {expandedId === row.lesseeId
                                ? "Hide notes"
                                : "Notes"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );

                    if (expandedId !== row.lesseeId) {
                      return [mainRow];
                    }

                    return [
                      mainRow,
                      <tr
                        key={`${row.lesseeId}-notes`}
                        className={getStripedRowClassName(index)}
                      >
                        <td colSpan={6} className="px-4 py-3">
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                            <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                              Private / Internal Notes
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">
                              {row.privateNotes?.trim()
                                ? row.privateNotes
                                : "No private notes."}
                            </p>
                          </div>
                        </td>
                      </tr>,
                    ];
                  })
                )}
              </tbody>
            </table>
          </ScrollableTable>
        </>
      )}
    </div>
  );
}
