"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDeleteEntry, getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow } from "./landlords-utils";
import {
  PROPERTY_TYPE_OPTIONS,
  formatPropertyDate,
  formatPropertyType,
  type PropertyListRow,
  type PropertyType,
} from "./properties-utils";

type PropertiesProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  initialRows: PropertyListRow[];
  landlordsError: string | null;
  propertiesError: string | null;
};

const emptyForm = {
  name: "",
  property_type: "" as PropertyType | "",
  address_line1: "",
  address_line2: "",
  city: "",
  region: "",
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function Properties({
  landlords,
  selectedLandlordId,
  initialRows,
  landlordsError,
  propertiesError,
}: PropertiesProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? propertiesError,
  );
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(landlordsError ?? propertiesError);
  }, [landlordsError, propertiesError]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );

  function handleLandlordChange(tenantId: string) {
    setShowForm(false);
    setForm(emptyForm);
    if (!tenantId) {
      router.push("/dashboard/real-estate/properties");
      return;
    }
    router.push(
      `/dashboard/real-estate/properties?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId) {
      return;
    }

    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin/properties/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        name: form.name,
        property_type: form.property_type,
        address_line1: form.address_line1,
        address_line2: form.address_line2,
        city: form.city,
        region: form.region,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      property_id?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create property.");
      setLoading(false);
      return;
    }

    setForm(emptyForm);
    setShowForm(false);
    setLoading(false);
    router.refresh();
  }

  async function handleDelete(propertyId: string) {
    if (!selectedLandlordId || !confirmDeleteEntry()) {
      return;
    }

    setDeletingId(propertyId);
    setError(null);

    const response = await fetch("/api/admin/properties/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        property_id: propertyId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to delete property.");
      setDeletingId(null);
      return;
    }

    setDeletingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label
          htmlFor="properties-landlord-picker"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Landlord
        </label>
        <select
          id="properties-landlord-picker"
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
            Select a landlord to view and manage their properties.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Properties are scoped to the selected landlord tenant.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">
              Managing properties for{" "}
              <span className="font-medium text-[#0f2744]">
                {selectedLandlord?.name ?? "selected landlord"}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm);
                setShowForm((current) => !current);
              }}
              className={primaryButtonClassName}
            >
              {showForm ? "Cancel" : "Add Property"}
            </button>
          </div>

          {showForm ? (
            <form
              onSubmit={handleCreate}
              className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
                New Property
              </h3>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Name
                  </label>
                  <input
                    required
                    type="text"
                    value={form.name}
                    onChange={(event) => updateField("name", event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Property Type
                  </label>
                  <select
                    required
                    value={form.property_type}
                    onChange={(event) =>
                      updateField("property_type", event.target.value)
                    }
                    className={inputClassName}
                  >
                    <option value="">Select type</option>
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
                    required
                    type="text"
                    value={form.address_line1}
                    onChange={(event) =>
                      updateField("address_line1", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Address Line 2
                  </label>
                  <input
                    required
                    type="text"
                    value={form.address_line2}
                    onChange={(event) =>
                      updateField("address_line2", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    City
                  </label>
                  <input
                    required
                    type="text"
                    value={form.city}
                    onChange={(event) => updateField("city", event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Region
                  </label>
                  <input
                    required
                    type="text"
                    value={form.region}
                    onChange={(event) =>
                      updateField("region", event.target.value)
                    }
                    className={inputClassName}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={primaryButtonClassName}
                >
                  {loading ? "Saving…" : "Save Property"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
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
                  <th className={scrollableTableThClassName}>Name</th>
                  <th className={scrollableTableThClassName}>Property Type</th>
                  <th className={scrollableTableThClassName}>City</th>
                  <th className={scrollableTableThClassName}>Unit Count</th>
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
                      No properties yet for this landlord.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr
                      key={row.propertyId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                        <Link
                          href={`/dashboard/real-estate/properties/${row.tenantId}/${row.propertyId}`}
                          className="hover:underline"
                        >
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatPropertyType(row.propertyType)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.city}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.unitCount}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatPropertyDate(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          disabled={deletingId === row.propertyId}
                          onClick={() => handleDelete(row.propertyId)}
                          className="text-red-700 hover:underline disabled:opacity-50"
                        >
                          {deletingId === row.propertyId
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ScrollableTable>
        </>
      )}
    </div>
  );
}
