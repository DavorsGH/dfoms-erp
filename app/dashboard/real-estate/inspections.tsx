"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow } from "./landlords-utils";
import {
  INSPECTION_CONDITION_OPTIONS,
  INSPECTION_TYPE_OPTIONS,
  createBlankInspectionChecklistItem,
  createDefaultInspectionChecklist,
  formatInspectionDate,
  formatInspectionType,
  type InspectionChecklistItem,
  type InspectionCondition,
  type InspectionLeaseOption,
  type InspectionListRow,
  type InspectionType,
} from "./inspections-utils";

type InspectionsProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  initialRows: InspectionListRow[];
  leaseOptions: InspectionLeaseOption[];
  landlordsError: string | null;
  inspectionsError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function todayInputValue() {
  return new Date().toISOString().slice(0, 10);
}

function ChecklistEditor({
  checklist,
  onChange,
  idPrefix,
}: {
  checklist: InspectionChecklistItem[];
  onChange: (next: InspectionChecklistItem[]) => void;
  idPrefix: string;
}) {
  function updateItem(
    index: number,
    patch: Partial<InspectionChecklistItem>,
  ) {
    onChange(
      checklist.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function deleteItem(index: number) {
    onChange(checklist.filter((_, itemIndex) => itemIndex !== index));
  }

  function addItem() {
    onChange([...checklist, createBlankInspectionChecklistItem()]);
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-slate-600">
                Item
              </th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">
                Condition
              </th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">
                Note
              </th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {checklist.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-3 py-4 text-center text-sm text-slate-500"
                >
                  No checklist items. Add an item below.
                </td>
              </tr>
            ) : (
              checklist.map((item, index) => (
                <tr key={`${idPrefix}-row-${index}`}>
                  <td className="px-3 py-2">
                    <input
                      id={`${idPrefix}-name-${index}`}
                      type="text"
                      required
                      className={inputClassName}
                      value={item.name}
                      onChange={(event) =>
                        updateItem(index, { name: event.target.value })
                      }
                      placeholder="Item name"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <select
                      id={`${idPrefix}-condition-${index}`}
                      className={inputClassName}
                      value={item.condition}
                      onChange={(event) =>
                        updateItem(index, {
                          condition: event.target
                            .value as InspectionCondition,
                        })
                      }
                    >
                      {INSPECTION_CONDITION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      id={`${idPrefix}-note-${index}`}
                      type="text"
                      className={inputClassName}
                      value={item.note}
                      onChange={(event) =>
                        updateItem(index, { note: event.target.value })
                      }
                      placeholder="Optional note"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className={secondaryButtonClassName}
                      onClick={() => deleteItem(index)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        className={secondaryButtonClassName}
        onClick={addItem}
      >
        Add Item
      </button>
    </div>
  );
}

export default function Inspections({
  landlords,
  selectedLandlordId,
  initialRows,
  leaseOptions,
  landlordsError,
  inspectionsError,
}: InspectionsProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? inspectionsError,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    lease_id: "",
    inspection_type: "move_in" as InspectionType,
    inspection_date: todayInputValue(),
    conducted_by: "",
    notes: "",
    checklist: createDefaultInspectionChecklist(),
  });
  const [expandedInspectionId, setExpandedInspectionId] = useState<
    string | null
  >(null);
  const [editForm, setEditForm] = useState({
    inspection_type: "move_in" as InspectionType,
    inspection_date: todayInputValue(),
    conducted_by: "",
    notes: "",
    checklist: createDefaultInspectionChecklist(),
    photo_urls: [] as string[],
  });
  const [detailPhotoFiles, setDetailPhotoFiles] = useState<File[]>([]);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    if (!expandedInspectionId) {
      return;
    }
    const current = initialRows.find(
      (row) => row.inspectionId === expandedInspectionId,
    );
    if (!current) {
      setExpandedInspectionId(null);
      return;
    }
    setEditForm({
      inspection_type: current.inspectionType,
      inspection_date: current.inspectionDate.slice(0, 10),
      conducted_by: current.conductedBy ?? "",
      notes: current.notes ?? "",
      checklist: current.checklist.map((item) => ({ ...item })),
      photo_urls: [...current.photoUrls],
    });
  }, [initialRows, expandedInspectionId]);

  useEffect(() => {
    setError(landlordsError ?? inspectionsError);
  }, [landlordsError, inspectionsError]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );

  const filteredRows = useMemo(() => {
    if (!typeFilter) {
      return rows;
    }
    return rows.filter((row) => row.inspectionType === typeFilter);
  }, [rows, typeFilter]);

  const expandedRow = rows.find(
    (row) => row.inspectionId === expandedInspectionId,
  );

  function handleLandlordChange(tenantId: string) {
    setShowForm(false);
    setExpandedInspectionId(null);
    setSuccess(null);
    if (!tenantId) {
      router.push("/dashboard/real-estate/inspections");
      return;
    }
    router.push(
      `/dashboard/real-estate/inspections?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  function openDetail(row: InspectionListRow) {
    setError(null);
    setSuccess(null);
    setExpandedInspectionId(row.inspectionId);
    setDetailPhotoFiles([]);
    setEditForm({
      inspection_type: row.inspectionType,
      inspection_date: row.inspectionDate.slice(0, 10),
      conducted_by: row.conductedBy ?? "",
      notes: row.notes ?? "",
      checklist: row.checklist.map((item) => ({ ...item })),
      photo_urls: [...row.photoUrls],
    });
  }

  async function uploadPhotos(inspectionId: string, files: File[]) {
    if (!selectedLandlordId || files.length === 0) {
      return { ok: true as const };
    }

    for (const file of files) {
      const formData = new FormData();
      formData.set("tenant_id", selectedLandlordId);
      formData.set("inspection_id", inspectionId);
      formData.set("file", file);

      const response = await fetch("/api/admin/inspections/upload-photo", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        return {
          ok: false as const,
          error: payload?.error ?? "Unable to upload photo.",
        };
      }
    }

    return { ok: true as const };
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/inspections/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        lease_id: form.lease_id,
        inspection_type: form.inspection_type,
        inspection_date: form.inspection_date,
        conducted_by: form.conducted_by,
        notes: form.notes || null,
        checklist: form.checklist,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      inspection_id?: string;
    } | null;

    if (!response.ok || !payload?.inspection_id) {
      setError(payload?.error ?? "Unable to create inspection.");
      setLoading(false);
      return;
    }

    if (photoFiles.length > 0) {
      const uploadResult = await uploadPhotos(
        payload.inspection_id,
        photoFiles,
      );
      if (!uploadResult.ok) {
        setError(
          `Inspection created, but photo upload failed: ${uploadResult.error}`,
        );
        setLoading(false);
        setShowForm(false);
        setPhotoFiles([]);
        router.refresh();
        return;
      }
    }

    setShowForm(false);
    setForm({
      lease_id: "",
      inspection_type: "move_in",
      inspection_date: todayInputValue(),
      conducted_by: "",
      notes: "",
      checklist: createDefaultInspectionChecklist(),
    });
    setPhotoFiles([]);
    setLoading(false);
    setSuccess("Inspection created.");
    router.refresh();
  }

  async function handleUpdate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId || !expandedInspectionId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/inspections/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        inspection_id: expandedInspectionId,
        inspection_type: editForm.inspection_type,
        inspection_date: editForm.inspection_date,
        conducted_by: editForm.conducted_by,
        notes: editForm.notes || null,
        checklist: editForm.checklist,
        photo_urls: editForm.photo_urls,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update inspection.");
      setLoading(false);
      return;
    }

    if (detailPhotoFiles.length > 0) {
      const uploadResult = await uploadPhotos(
        expandedInspectionId,
        detailPhotoFiles,
      );
      if (!uploadResult.ok) {
        setError(
          `Inspection updated, but photo upload failed: ${uploadResult.error}`,
        );
        setLoading(false);
        setDetailPhotoFiles([]);
        router.refresh();
        return;
      }
      setDetailPhotoFiles([]);
    }

    setLoading(false);
    setSuccess("Inspection updated.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label
          htmlFor="inspections-landlord-picker"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Landlord
        </label>
        <select
          id="inspections-landlord-picker"
          className={inputClassName}
          value={selectedLandlordId ?? ""}
          onChange={(event) => handleLandlordChange(event.target.value)}
        >
          <option value="">Select a Davors-managed landlord…</option>
          {landlords.map((landlord) => (
            <option key={landlord.tenantId} value={landlord.tenantId}>
              {landlord.name}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}
      {success ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </div>
      ) : null}

      {!selectedLandlordId ? (
        <p className="text-sm text-slate-600">
          Select a Davors-managed landlord to view and record inspections.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[#0f2744]">
                {selectedLandlord?.name ?? "Landlord"}
              </h2>
              <p className="text-sm text-slate-600">
                Move-in and move-out inspections for this landlord&apos;s
                leases.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="inspections-type-filter"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Filter by type
                </label>
                <select
                  id="inspections-type-filter"
                  className={inputClassName}
                  value={typeFilter}
                  onChange={(event) => setTypeFilter(event.target.value)}
                >
                  <option value="">All types</option>
                  {INSPECTION_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                className={primaryButtonClassName}
                disabled={loading || leaseOptions.length === 0}
                onClick={() => {
                  setShowForm((current) => !current);
                  setForm({
                    lease_id: "",
                    inspection_type: "move_in",
                    inspection_date: todayInputValue(),
                    conducted_by: "",
                    notes: "",
                    checklist: createDefaultInspectionChecklist(),
                  });
                  setPhotoFiles([]);
                  setError(null);
                  setSuccess(null);
                }}
              >
                {showForm ? "Cancel" : "Add Inspection"}
              </button>
            </div>
          </div>

          {leaseOptions.length === 0 ? (
            <p className="text-sm text-slate-600">
              No active or recently ended leases for this landlord. Create or
              end a lease before recording inspections.
            </p>
          ) : null}

          {showForm ? (
            <form
              onSubmit={handleCreate}
              className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <h3 className="text-base font-semibold text-[#0f2744]">
                Add Inspection
              </h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="inspection-lease"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Lease
                  </label>
                  <select
                    id="inspection-lease"
                    required
                    className={inputClassName}
                    value={form.lease_id}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        lease_id: event.target.value,
                      }))
                    }
                  >
                    <option value="">Select a lease…</option>
                    {leaseOptions.map((lease) => (
                      <option key={lease.leaseId} value={lease.leaseId}>
                        {lease.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="inspection-type"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Inspection type
                  </label>
                  <select
                    id="inspection-type"
                    required
                    className={inputClassName}
                    value={form.inspection_type}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        inspection_type: event.target
                          .value as InspectionType,
                      }))
                    }
                  >
                    {INSPECTION_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="inspection-date"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Inspection date
                  </label>
                  <input
                    id="inspection-date"
                    required
                    type="date"
                    className={inputClassName}
                    value={form.inspection_date}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        inspection_date: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label
                    htmlFor="inspection-conducted-by"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Conducted by
                  </label>
                  <input
                    id="inspection-conducted-by"
                    required
                    type="text"
                    className={inputClassName}
                    value={form.conducted_by}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        conducted_by: event.target.value,
                      }))
                    }
                    placeholder="Staff name"
                  />
                </div>
                <div>
                  <p className="mb-1 text-sm font-medium text-slate-700">
                    Photos (optional)
                  </p>
                  <ImageFileUploadButton
                    inputId="inspection-photos"
                    files={photoFiles}
                    onChange={setPhotoFiles}
                    multiple
                  />
                </div>
                <div className="md:col-span-2">
                  <label
                    htmlFor="inspection-notes"
                    className="mb-1 block text-sm font-medium text-slate-700"
                  >
                    Notes
                  </label>
                  <textarea
                    id="inspection-notes"
                    rows={3}
                    className={textareaClassName}
                    value={form.notes}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        notes: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-[#0f2744]">
                  Checklist
                </h4>
                <ChecklistEditor
                  idPrefix="create"
                  checklist={form.checklist}
                  onChange={(checklist) =>
                    setForm((current) => ({ ...current, checklist }))
                  }
                />
              </div>

              <button
                type="submit"
                className={primaryButtonClassName}
                disabled={loading}
              >
                {loading ? "Saving…" : "Create inspection"}
              </button>
            </form>
          ) : null}

          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Tenant</th>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Type</th>
                  <th className={scrollableTableThClassName}>Date</th>
                  <th className={scrollableTableThClassName}>Conducted By</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-center text-sm text-slate-500"
                    >
                      No inspections for this landlord
                      {typeFilter ? " with the selected type" : ""}.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, index) => (
                    <tr
                      key={row.inspectionId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm text-slate-900">
                        {row.lesseeName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.unitLabel}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatInspectionType(row.inspectionType)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatInspectionDate(row.inspectionDate)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.conductedBy || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          className={secondaryButtonClassName}
                          onClick={() =>
                            expandedInspectionId === row.inspectionId
                              ? setExpandedInspectionId(null)
                              : openDetail(row)
                          }
                        >
                          {expandedInspectionId === row.inspectionId
                            ? "Close"
                            : "Open"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>

          {expandedRow ? (
            <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div>
                <h3 className="text-base font-semibold text-[#0f2744]">
                  Inspection detail
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  {expandedRow.lesseeName} · {expandedRow.unitLabel}
                </p>
              </div>

              <form onSubmit={handleUpdate} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label
                      htmlFor="edit-inspection-type"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Inspection type
                    </label>
                    <select
                      id="edit-inspection-type"
                      required
                      className={inputClassName}
                      value={editForm.inspection_type}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          inspection_type: event.target
                            .value as InspectionType,
                        }))
                      }
                    >
                      {INSPECTION_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label
                      htmlFor="edit-inspection-date"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Inspection date
                    </label>
                    <input
                      id="edit-inspection-date"
                      required
                      type="date"
                      className={inputClassName}
                      value={editForm.inspection_date}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          inspection_date: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="edit-conducted-by"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Conducted by
                    </label>
                    <input
                      id="edit-conducted-by"
                      required
                      type="text"
                      className={inputClassName}
                      value={editForm.conducted_by}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          conducted_by: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-sm font-medium text-slate-700">
                      Add photos
                    </p>
                    <ImageFileUploadButton
                      inputId="edit-inspection-photos"
                      files={detailPhotoFiles}
                      onChange={setDetailPhotoFiles}
                      multiple
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label
                      htmlFor="edit-inspection-notes"
                      className="mb-1 block text-sm font-medium text-slate-700"
                    >
                      Notes
                    </label>
                    <textarea
                      id="edit-inspection-notes"
                      rows={3}
                      className={textareaClassName}
                      value={editForm.notes}
                      onChange={(event) =>
                        setEditForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-sm font-semibold text-[#0f2744]">
                    Checklist
                  </h4>
                  <ChecklistEditor
                    idPrefix="edit"
                    checklist={editForm.checklist}
                    onChange={(checklist) =>
                      setEditForm((current) => ({ ...current, checklist }))
                    }
                  />
                </div>

                {editForm.photo_urls.length > 0 ? (
                  <div className="flex flex-wrap gap-3">
                    {editForm.photo_urls.map((url) => (
                      <div
                        key={url}
                        className="relative overflow-hidden rounded-md border border-slate-200"
                      >
                        <a href={url} target="_blank" rel="noreferrer">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={url}
                            alt="Inspection"
                            className="h-24 w-24 object-cover"
                          />
                        </a>
                        <button
                          type="button"
                          className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-red-700 shadow-sm hover:bg-white"
                          onClick={() =>
                            setEditForm((current) => ({
                              ...current,
                              photo_urls: current.photo_urls.filter(
                                (photoUrl) => photoUrl !== url,
                              ),
                            }))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <button
                  type="submit"
                  className={primaryButtonClassName}
                  disabled={loading}
                >
                  {loading ? "Saving…" : "Save inspection"}
                </button>
              </form>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
