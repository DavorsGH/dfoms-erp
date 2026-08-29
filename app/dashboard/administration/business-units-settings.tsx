"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import { TenantLogosMediaImage } from "@/components/tenant-logos-media";
import { uploadBusinessUnitLogo } from "@/utils/business-unit-logo";
import {
  businessUnitToForm,
  emptyBusinessUnitForm,
  validateBusinessUnitInput,
  type BusinessUnitRow,
} from "@/utils/business-units-types";
import { createClient } from "@/utils/supabase/client";

type BusinessUnitsSettingsProps = {
  tenantId: string;
  initialUnits: BusinessUnitRow[];
  fetchError: string | null;
};

type FormState = ReturnType<typeof emptyBusinessUnitForm>;

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const cardClassName =
  "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function BusinessUnitsSettings({
  tenantId,
  initialUnits,
  fetchError,
}: BusinessUnitsSettingsProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [units, setUnits] = useState(initialUnits);
  const [formOpen, setFormOpen] = useState<"new" | string | null>(null);
  const [form, setForm] = useState<FormState>(() => emptyBusinessUnitForm());
  const [pendingLogoFile, setPendingLogoFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const editingUnit = useMemo(
    () =>
      formOpen && formOpen !== "new"
        ? (units.find((unit) => unit.id === formOpen) ?? null)
        : null,
    [units, formOpen],
  );

  function openCreateForm() {
    setForm(emptyBusinessUnitForm());
    setPendingLogoFile(null);
    setFormOpen("new");
    setError(null);
    setSuccess(null);
  }

  function openEditForm(unit: BusinessUnitRow) {
    setForm(businessUnitToForm(unit));
    setPendingLogoFile(null);
    setFormOpen(unit.id);
    setError(null);
    setSuccess(null);
  }

  function closeForm() {
    setFormOpen(null);
    setForm(emptyBusinessUnitForm());
    setPendingLogoFile(null);
  }

  function upsertUnit(next: BusinessUnitRow) {
    setUnits((current) => {
      const exists = current.some((unit) => unit.id === next.id);
      const list = exists
        ? current.map((unit) => (unit.id === next.id ? next : unit))
        : [...current, next];
      return list.sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  async function persistLogoUrl(
    businessUnitId: string,
    storagePath: string,
    baseFields: FormState,
  ): Promise<BusinessUnitRow | null> {
    const response = await fetch("/api/business-units", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: businessUnitId,
        ...baseFields,
        logo_url: storagePath,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { business_unit?: BusinessUnitRow; error?: string }
      | null;

    if (!response.ok || !payload?.business_unit) {
      setError(payload?.error ?? "Unable to save business unit logo.");
      return null;
    }

    return payload.business_unit;
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const validationError = validateBusinessUnitInput(form);
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const isEditing = formOpen !== null && formOpen !== "new";

    const response = await fetch("/api/business-units", {
      method: isEditing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isEditing
          ? {
              id: formOpen,
              ...form,
              ...(editingUnit?.logo_url
                ? { logo_url: editingUnit.logo_url }
                : {}),
            }
          : form,
      ),
    });

    const payload = (await response.json().catch(() => null)) as
      | { business_unit?: BusinessUnitRow; error?: string }
      | null;

    if (!response.ok || !payload?.business_unit) {
      setError(payload?.error ?? "Unable to save business unit.");
      setSaving(false);
      return;
    }

    let saved = payload.business_unit;

    if (pendingLogoFile) {
      const uploadResult = await uploadBusinessUnitLogo(
        supabase,
        tenantId,
        saved.id,
        pendingLogoFile,
      );

      if ("error" in uploadResult) {
        setError(uploadResult.error);
        upsertUnit(saved);
        setSaving(false);
        return;
      }

      const withLogo = await persistLogoUrl(
        saved.id,
        uploadResult.storagePath,
        form,
      );
      if (!withLogo) {
        upsertUnit(saved);
        setSaving(false);
        return;
      }
      saved = withLogo;
    }

    upsertUnit(saved);
    setSuccess(isEditing ? "Business unit updated." : "Business unit created.");
    closeForm();
    setSaving(false);
    router.refresh();
  }

  async function handleSetActive(unit: BusinessUnitRow, isActive: boolean) {
    const actionLabel = isActive ? "reactivate" : "deactivate";
    const confirmed = window.confirm(
      isActive
        ? `Reactivate "${unit.name}"? It will appear again in the business switcher and create pickers.`
        : `Deactivate "${unit.name}"? It will be hidden from the switcher and create pickers. Historical records stay intact.`,
    );

    if (!confirmed) {
      return;
    }

    setTogglingId(unit.id);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/business-units", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: unit.id, is_active: isActive }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { business_unit?: BusinessUnitRow; error?: string }
      | null;

    if (!response.ok || !payload?.business_unit) {
      setError(payload?.error ?? `Unable to ${actionLabel} business unit.`);
      setTogglingId(null);
      return;
    }

    upsertUnit(payload.business_unit);

    if (formOpen === unit.id) {
      setForm((current) => ({ ...current, is_active: isActive }));
    }

    setSuccess(
      isActive ? "Business unit reactivated." : "Business unit deactivated.",
    );
    setTogglingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {success}
        </p>
      ) : null}

      <section className={cardClassName}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-sm font-medium text-slate-700">
              Business Units
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              Separate operating businesses under this workspace. Leave empty if
              you only run one business — nothing else in the app changes until
              you add units.
            </p>
          </div>
          {units.length > 0 ? (
            <button
              type="button"
              onClick={openCreateForm}
              className={primaryButtonClassName}
            >
              Add Business Unit
            </button>
          ) : null}
        </div>

        {units.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
            <p className="text-sm font-medium text-slate-800">
              Create your first business
            </p>
            <p className="mt-1 text-sm text-slate-500">
              Add a business unit when you need separate branding, invoices, or
              reporting under this workspace.
            </p>
            <button
              type="button"
              onClick={openCreateForm}
              className={`${primaryButtonClassName} mt-4`}
            >
              Create your first business
            </button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {units.map((unit) => (
              <article
                key={unit.id}
                className="space-y-3 rounded-md border border-slate-200 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    {unit.logo_url ? (
                      <TenantLogosMediaImage
                        reference={unit.logo_url}
                        tenantId={tenantId}
                        alt={`${unit.name} logo`}
                        className="h-20 w-20 shrink-0 rounded-sm border border-slate-200 object-cover bg-white"
                      />
                    ) : (
                      <div
                        className="flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border border-slate-200 bg-white text-xs font-medium text-slate-400"
                        aria-hidden
                      >
                        —
                      </div>
                    )}
                    <div className="min-w-0">
                      <h4 className="truncate text-base font-semibold text-[#0f2744]">
                        {unit.name}
                      </h4>
                      <span
                        className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          unit.is_active
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {unit.is_active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  </div>
                </div>

                {unit.invoice_address ? (
                  <p className="whitespace-pre-line text-sm text-slate-700">
                    {unit.invoice_address}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">
                    No invoice address set.
                  </p>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openEditForm(unit)}
                    className={secondaryButtonClassName}
                    disabled={saving || togglingId === unit.id}
                  >
                    Edit
                  </button>
                  {unit.is_active ? (
                    <button
                      type="button"
                      onClick={() => handleSetActive(unit, false)}
                      className={dangerButtonClassName}
                      disabled={saving || togglingId === unit.id}
                    >
                      {togglingId === unit.id ? "Deactivating…" : "Deactivate"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleSetActive(unit, true)}
                      className={secondaryButtonClassName}
                      disabled={saving || togglingId === unit.id}
                    >
                      {togglingId === unit.id ? "Reactivating…" : "Reactivate"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {formOpen ? (
        <section className={cardClassName}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-medium text-slate-700">
                {formOpen === "new" ? "New Business Unit" : "Edit Business Unit"}
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                Name is required. Logo and invoice address are optional.
              </p>
            </div>
            <button
              type="button"
              onClick={closeForm}
              className={secondaryButtonClassName}
              disabled={saving}
            >
              Cancel
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="business-unit-name"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Name <span className="text-red-600">*</span>
              </label>
              <input
                id="business-unit-name"
                type="text"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                className={inputClassName}
                required
                disabled={saving}
              />
            </div>

            <div>
              <p className="mb-1 text-sm font-medium text-slate-700">Logo</p>
              {editingUnit?.logo_url && !pendingLogoFile ? (
                <TenantLogosMediaImage
                  reference={editingUnit.logo_url}
                  tenantId={tenantId}
                  alt={`${editingUnit.name} logo preview`}
                  className="mb-3 h-16 w-16 rounded-md border border-slate-200 object-contain bg-white"
                />
              ) : null}
              {pendingLogoFile ? (
                <p className="mb-2 text-sm text-slate-600">
                  Selected: {pendingLogoFile.name}
                </p>
              ) : null}
              <ImageFileUploadButton
                files={pendingLogoFile ? [pendingLogoFile] : []}
                multiple={false}
                disabled={saving}
                addLabel="Upload logo"
                changeLabel="Change logo"
                resetInputAfterSelect
                onChange={(next) => {
                  setPendingLogoFile(next[0] ?? null);
                }}
              />
            </div>

            <div>
              <label
                htmlFor="business-unit-invoice-address"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Invoice address
              </label>
              <textarea
                id="business-unit-invoice-address"
                value={form.invoice_address}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    invoice_address: event.target.value,
                  }))
                }
                rows={4}
                className={inputClassName}
                disabled={saving}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    is_active: event.target.checked,
                  }))
                }
                disabled={saving}
                className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
              />
              Active
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                className={primaryButtonClassName}
                disabled={saving}
              >
                {saving
                  ? "Saving…"
                  : formOpen === "new"
                    ? "Create Business Unit"
                    : "Save Changes"}
              </button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
