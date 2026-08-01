"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import {
  PROPERTY_TYPE_OPTIONS,
  UNIT_STATUS_OPTIONS,
  formatPropertyRent,
  formatUnitStatus,
  type PropertyDetail,
  type PropertyType,
  type PropertyUnitRecord,
  type UnitStatus,
} from "./properties-utils";

type PropertyDetailViewProps = {
  initialDetail: PropertyDetail;
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const emptyUnitForm = {
  unit_number: "",
  bedrooms: "",
  bathrooms: "",
  base_rent_ghs: "",
  status: "vacant" as UnitStatus | "",
};

function PhotoGallery({
  urls,
  uploading,
  onUpload,
  onRemove,
}: {
  urls: string[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: (url: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {urls.length === 0 ? (
          <p className="text-sm text-slate-500">No photos yet.</p>
        ) : (
          urls.map((url) => (
            <div
              key={url}
              className="relative h-24 w-24 overflow-hidden rounded-md border border-slate-200 bg-slate-50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={url}
                alt="Property photo"
                className="h-full w-full object-cover"
              />
              <button
                type="button"
                onClick={() => onRemove(url)}
                className="absolute right-1 top-1 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-red-700 shadow-sm hover:bg-white"
              >
                Remove
              </button>
            </div>
          ))
        )}
      </div>
      <ImageFileUploadButton
        files={[]}
        onChange={(next) => {
          const file = next[0];
          if (file) {
            onUpload(file);
          }
        }}
        multiple={false}
        disabled={uploading}
        addLabel={uploading ? "Uploading…" : "Add photos"}
        showClear={false}
        resetInputAfterSelect
      />
    </div>
  );
}

export default function PropertyDetailView({
  initialDetail,
  fetchError,
}: PropertyDetailViewProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingProperty, setSavingProperty] = useState(false);
  const [uploadingPropertyPhoto, setUploadingPropertyPhoto] = useState(false);
  const [showUnitForm, setShowUnitForm] = useState(false);
  const [unitForm, setUnitForm] = useState(emptyUnitForm);
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [savingUnit, setSavingUnit] = useState(false);
  const [deletingUnitId, setDeletingUnitId] = useState<string | null>(null);
  const [uploadingUnitId, setUploadingUnitId] = useState<string | null>(null);

  const [name, setName] = useState(initialDetail.property.name);
  const [propertyType, setPropertyType] = useState<PropertyType>(
    initialDetail.property.propertyType,
  );
  const [addressLine1, setAddressLine1] = useState(
    initialDetail.property.addressLine1,
  );
  const [addressLine2, setAddressLine2] = useState(
    initialDetail.property.addressLine2 ?? "",
  );
  const [city, setCity] = useState(initialDetail.property.city);
  const [region, setRegion] = useState(initialDetail.property.region ?? "");

  useEffect(() => {
    setDetail(initialDetail);
    setName(initialDetail.property.name);
    setPropertyType(initialDetail.property.propertyType);
    setAddressLine1(initialDetail.property.addressLine1);
    setAddressLine2(initialDetail.property.addressLine2 ?? "");
    setCity(initialDetail.property.city);
    setRegion(initialDetail.property.region ?? "");
    setError(fetchError);
  }, [initialDetail, fetchError]);

  const tenantId = detail.property.tenantId;
  const propertyId = detail.property.propertyId;

  async function saveProperty(photoUrls = detail.property.photoUrls) {
    setSavingProperty(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/properties/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        property_id: propertyId,
        name,
        property_type: propertyType,
        address_line1: addressLine1,
        address_line2: addressLine2,
        city,
        region,
        photo_urls: photoUrls,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save property.");
      setSavingProperty(false);
      return false;
    }

    setSuccess("Property saved.");
    setSavingProperty(false);
    router.refresh();
    return true;
  }

  async function handlePropertyPhotoUpload(file: File) {
    setUploadingPropertyPhoto(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("tenant_id", tenantId);
    formData.set("entity", "property");
    formData.set("entity_id", propertyId);
    formData.set("file", file);

    const response = await fetch("/api/admin/properties/upload-photo", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      photo_urls?: string[];
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to upload photo.");
      setUploadingPropertyPhoto(false);
      return;
    }

    const nextUrls = payload?.photo_urls ?? detail.property.photoUrls;
    setDetail((current) => ({
      ...current,
      property: { ...current.property, photoUrls: nextUrls },
    }));
    setSuccess("Photo added.");
    setUploadingPropertyPhoto(false);
    router.refresh();
  }

  async function handleRemovePropertyPhoto(url: string) {
    const nextUrls = detail.property.photoUrls.filter((item) => item !== url);
    const ok = await saveProperty(nextUrls);
    if (ok) {
      setDetail((current) => ({
        ...current,
        property: { ...current.property, photoUrls: nextUrls },
      }));
    }
  }

  function openAddUnit() {
    setEditingUnitId(null);
    setUnitForm(emptyUnitForm);
    setShowUnitForm(true);
  }

  function openEditUnit(unit: PropertyUnitRecord) {
    setEditingUnitId(unit.unitId);
    setUnitForm({
      unit_number: unit.unitNumber,
      bedrooms: unit.bedrooms == null ? "" : String(unit.bedrooms),
      bathrooms: unit.bathrooms == null ? "" : String(unit.bathrooms),
      base_rent_ghs: String(unit.baseRentGhs),
      status: unit.status,
    });
    setShowUnitForm(true);
  }

  async function handleSaveUnit(event: React.FormEvent) {
    event.preventDefault();
    setSavingUnit(true);
    setError(null);
    setSuccess(null);

    const endpoint = editingUnitId
      ? "/api/admin/properties/units/update"
      : "/api/admin/properties/units/create";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        property_id: propertyId,
        unit_id: editingUnitId,
        unit_number: unitForm.unit_number,
        bedrooms: unitForm.bedrooms,
        bathrooms: unitForm.bathrooms,
        base_rent_ghs: unitForm.base_rent_ghs,
        status: unitForm.status,
        photo_urls: editingUnitId
          ? (detail.units.find((unit) => unit.unitId === editingUnitId)
              ?.photoUrls ?? [])
          : undefined,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save unit.");
      setSavingUnit(false);
      return;
    }

    setShowUnitForm(false);
    setEditingUnitId(null);
    setUnitForm(emptyUnitForm);
    setSavingUnit(false);
    setSuccess(editingUnitId ? "Unit updated." : "Unit added.");
    router.refresh();
  }

  async function handleStatusChange(unit: PropertyUnitRecord, status: string) {
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/properties/units/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        unit_id: unit.unitId,
        unit_number: unit.unitNumber,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        base_rent_ghs: unit.baseRentGhs,
        status,
        photo_urls: unit.photoUrls,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update unit status.");
      return;
    }

    setSuccess("Unit status updated.");
    router.refresh();
  }

  async function handleDeleteUnit(unitId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingUnitId(unitId);
    setError(null);

    const response = await fetch("/api/admin/properties/units/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        unit_id: unitId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to delete unit.");
      setDeletingUnitId(null);
      return;
    }

    setDeletingUnitId(null);
    setSuccess("Unit deleted.");
    router.refresh();
  }

  async function handleUnitPhotoUpload(unit: PropertyUnitRecord, file: File) {
    setUploadingUnitId(unit.unitId);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("tenant_id", tenantId);
    formData.set("entity", "unit");
    formData.set("entity_id", unit.unitId);
    formData.set("file", file);

    const response = await fetch("/api/admin/properties/upload-photo", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      photo_urls?: string[];
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to upload unit photo.");
      setUploadingUnitId(null);
      return;
    }

    const nextUrls = payload?.photo_urls ?? unit.photoUrls;
    setDetail((current) => ({
      ...current,
      units: current.units.map((item) =>
        item.unitId === unit.unitId
          ? { ...item, photoUrls: nextUrls }
          : item,
      ),
    }));
    setSuccess("Unit photo added.");
    setUploadingUnitId(null);
    router.refresh();
  }

  async function handleRemoveUnitPhoto(unit: PropertyUnitRecord, url: string) {
    const nextUrls = unit.photoUrls.filter((item) => item !== url);
    setError(null);

    const response = await fetch("/api/admin/properties/units/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: tenantId,
        unit_id: unit.unitId,
        unit_number: unit.unitNumber,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        base_rent_ghs: unit.baseRentGhs,
        status: unit.status,
        photo_urls: nextUrls,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to remove photo.");
      return;
    }

    setDetail((current) => ({
      ...current,
      units: current.units.map((item) =>
        item.unitId === unit.unitId
          ? { ...item, photoUrls: nextUrls }
          : item,
      ),
    }));
    setSuccess("Photo removed.");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <Link
        href={`/dashboard/real-estate/properties?landlord=${encodeURIComponent(tenantId)}`}
        className="inline-block text-sm font-medium text-[#0f2744] hover:underline"
      >
        ← Back to Properties
      </Link>

      <p className="text-sm text-slate-600">
        Landlord:{" "}
        <span className="font-medium text-[#0f2744]">{detail.landlordName}</span>
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      <section className="space-y-4 rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Property Details
        </h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Property Type
            </label>
            <select
              value={propertyType}
              onChange={(event) =>
                setPropertyType(event.target.value as PropertyType)
              }
              className={inputClassName}
            >
              {PROPERTY_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Address Line 1
            </label>
            <input
              type="text"
              value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Address Line 2
            </label>
            <input
              type="text"
              value={addressLine2}
              onChange={(event) => setAddressLine2(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              City
            </label>
            <input
              type="text"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Region
            </label>
            <input
              type="text"
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-medium text-slate-700">Photos</h4>
          <PhotoGallery
            urls={detail.property.photoUrls}
            uploading={uploadingPropertyPhoto}
            onUpload={handlePropertyPhotoUpload}
            onRemove={handleRemovePropertyPhoto}
          />
        </div>

        <button
          type="button"
          disabled={savingProperty}
          onClick={() => saveProperty()}
          className={primaryButtonClassName}
        >
          {savingProperty ? "Saving…" : "Save Property"}
        </button>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
            Units
          </h3>
          <button
            type="button"
            onClick={() => {
              if (showUnitForm && !editingUnitId) {
                setShowUnitForm(false);
                setUnitForm(emptyUnitForm);
              } else {
                openAddUnit();
              }
            }}
            className={primaryButtonClassName}
          >
            {showUnitForm && !editingUnitId ? "Cancel" : "Add Unit"}
          </button>
        </div>

        {showUnitForm ? (
          <form
            onSubmit={handleSaveUnit}
            className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
          >
            <h4 className="text-sm font-semibold text-[#0f2744]">
              {editingUnitId ? "Edit Unit" : "New Unit"}
            </h4>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Unit Number
                </label>
                <input
                  required
                  type="text"
                  value={unitForm.unit_number}
                  onChange={(event) =>
                    setUnitForm((current) => ({
                      ...current,
                      unit_number: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Bedrooms
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={unitForm.bedrooms}
                  onChange={(event) =>
                    setUnitForm((current) => ({
                      ...current,
                      bedrooms: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Bathrooms
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={unitForm.bathrooms}
                  onChange={(event) =>
                    setUnitForm((current) => ({
                      ...current,
                      bathrooms: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Base Rent (GHS)
                </label>
                <input
                  required
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitForm.base_rent_ghs}
                  onChange={(event) =>
                    setUnitForm((current) => ({
                      ...current,
                      base_rent_ghs: event.target.value,
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
                  required
                  value={unitForm.status}
                  onChange={(event) =>
                    setUnitForm((current) => ({
                      ...current,
                      status: event.target.value as UnitStatus,
                    }))
                  }
                  className={inputClassName}
                >
                  {UNIT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={savingUnit}
                className={primaryButtonClassName}
              >
                {savingUnit ? "Saving…" : "Save Unit"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowUnitForm(false);
                  setEditingUnitId(null);
                  setUnitForm(emptyUnitForm);
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
                <th className={scrollableTableThClassName}>Unit Number</th>
                <th className={scrollableTableThClassName}>Bedrooms</th>
                <th className={scrollableTableThClassName}>Bathrooms</th>
                <th className={scrollableTableThClassName}>Base Rent (GHS)</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {detail.units.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No units yet for this property.
                  </td>
                </tr>
              ) : (
                detail.units.map((unit, index) => (
                  <tr key={unit.unitId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                      {unit.unitNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {unit.bedrooms ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {unit.bathrooms ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatPropertyRent(unit.baseRentGhs)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      <select
                        value={unit.status}
                        onChange={(event) =>
                          handleStatusChange(unit, event.target.value)
                        }
                        className={inputClassName}
                        aria-label={`Status for unit ${unit.unitNumber}`}
                      >
                        {UNIT_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <span className="sr-only">
                        {formatUnitStatus(unit.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="button"
                          onClick={() => openEditUnit(unit)}
                          className="text-[#0f2744] hover:underline"
                        >
                          Edit
                        </button>
                        <ImageFileUploadButton
                          files={[]}
                          onChange={(next) => {
                            const file = next[0];
                            if (file) {
                              void handleUnitPhotoUpload(unit, file);
                            }
                          }}
                          multiple={false}
                          disabled={uploadingUnitId === unit.unitId}
                          addLabel={
                            uploadingUnitId === unit.unitId
                              ? "Uploading…"
                              : "Add photos"
                          }
                          showClear={false}
                          resetInputAfterSelect
                        />
                        <button
                          type="button"
                          disabled={deletingUnitId === unit.unitId}
                          onClick={() => handleDeleteUnit(unit.unitId)}
                          className="text-red-700 hover:underline disabled:opacity-50"
                        >
                          {deletingUnitId === unit.unitId
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </div>
                      {unit.photoUrls.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {unit.photoUrls.map((url) => (
                            <div
                              key={url}
                              className="relative h-16 w-16 overflow-hidden rounded border border-slate-200"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={url}
                                alt={`Unit ${unit.unitNumber} photo`}
                                className="h-full w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  handleRemoveUnitPhoto(unit, url)
                                }
                                className="absolute right-0.5 top-0.5 rounded bg-white/90 px-1 text-[10px] font-medium text-red-700"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
