"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableWrapThClassName,
} from "@/app/dashboard/scrollable-table";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import {
  buildServiceCatalogSavePayload,
  EMPTY_SERVICE_CATALOG_FORM,
  formatServiceCatalogRate,
  normalizeServiceCatalogEntry,
  serviceCatalogEntryToForm,
  SERVICE_CATALOG_SELECT,
  type ServiceCatalogEntry,
  type ServiceCatalogFormState,
} from "./service-catalog-utils";

type ServiceCatalogListProps = {
  initialServices: ServiceCatalogEntry[];
  fetchError: string | null;
};

const sectionActionLinkClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

export default function ServiceCatalogList({
  initialServices,
  fetchError,
}: ServiceCatalogListProps) {
  const supabase = createClient();
  const [services, setServices] = useState(initialServices);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceCatalogFormState>(
    EMPTY_SERVICE_CATALOG_FORM,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setServices(initialServices.map(normalizeServiceCatalogEntry));
  }, [initialServices]);

  async function refreshServices() {
    const { data, error: refreshError } = await supabase
      .from("service_catalog")
      .select(SERVICE_CATALOG_SELECT)
      .order("service_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setServices(
      ((data as ServiceCatalogEntry[] | null) ?? []).map(
        normalizeServiceCatalogEntry,
      ),
    );
    setError(null);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_SERVICE_CATALOG_FORM);
  }

  function openAddForm() {
    setEditingId(null);
    setForm(EMPTY_SERVICE_CATALOG_FORM);
    setShowForm(true);
  }

  function openEditForm(service: ServiceCatalogEntry) {
    setEditingId(service.id);
    setForm(serviceCatalogEntryToForm(service));
    setShowForm(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = buildServiceCatalogSavePayload(form);
    if (!payload.service_name) {
      setError("Service name is required.");
      setLoading(false);
      return;
    }

    if (editingId) {
      const { error: saveError } = await supabase
        .from("service_catalog")
        .update(payload)
        .eq("id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const { tenantId, error: tenantError } =
        await resolveSessionTenantId(supabase);

      if (tenantError || !tenantId) {
        setError(tenantError ?? "Unable to resolve workspace for this session.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("service_catalog").insert({
        ...payload,
        tenant_id: tenantId,
      });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshServices();
    setLoading(false);
  }

  async function handleDelete(serviceId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(serviceId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("service_catalog")
      .delete()
      .eq("id", serviceId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === serviceId) {
      closeForm();
    }

    await refreshServices();
    setDeletingId(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Manage billable services, default rates, and billing units.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/dashboard/bulk-import?type=service"
            className={sectionActionLinkClassName}
          >
            Bulk Import Services
          </Link>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className={primaryButtonClassName}
          >
            {showForm ? "Cancel" : "Add Service"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingId ? "Edit Service" : "Add Service"}
          </h3>
          <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Service name
              </label>
              <input
                type="text"
                required
                value={form.service_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    service_name: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Description
              </label>
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Default rate
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.default_rate}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    default_rate: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Billing unit
              </label>
              <input
                type="text"
                value={form.billing_unit}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    billing_unit: event.target.value,
                  }))
                }
                placeholder="e.g. per visit"
                className={inputClassName}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Category
              </label>
              <input
                type="text"
                value={form.category}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div className="sm:col-span-2 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeForm}
                className={sectionActionLinkClassName}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className={primaryButtonClassName}
              >
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Service"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Service name</th>
                <th className={scrollableTableWrapThClassName}>Description</th>
                <th className={scrollableTableThClassName}>Default rate</th>
                <th className={scrollableTableThClassName}>Billing unit</th>
                <th className={scrollableTableThClassName}>Category</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {services.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No services in the catalog yet.
                  </td>
                </tr>
              ) : (
                services.map((service, index) => (
                  <tr
                    key={service.id}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-slate-800">
                      {service.service_name}
                    </td>
                    <td className={`${scrollableTableWrapTdClassName} text-sm text-slate-700`}>
                      {service.description ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatServiceCatalogRate(service.default_rate)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {service.billing_unit ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {service.category ?? "—"}
                    </td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(service)}
                      onDelete={() => handleDelete(service.id)}
                      deleting={deletingId === service.id}
                      disableEdit={loading}
                      disableDelete={loading}
                    />
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
