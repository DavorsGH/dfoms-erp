"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NotificationTargetUnavailableBanner } from "@/components/notification-target-unavailable";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import {
  LANDLORD_APPROVAL_STATUS_OPTIONS,
  LANDLORD_TYPE_OPTIONS,
  formatLandlordApprovalStatus,
  formatLandlordDate,
  formatLandlordTier,
  formatLandlordType,
  type LandlordListRow,
} from "./landlords-utils";

type LandlordsProps = {
  initialRows: LandlordListRow[];
  fetchError: string | null;
  /** Scroll/highlight target from `?highlight=` (staff notification deep-link). */
  highlightTenantId?: string | null;
};

const emptyForm = {
  name: "",
  email: "",
  phone: "",
  address: "",
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function Landlords({
  initialRows,
  fetchError,
  highlightTenantId = null,
}: LandlordsProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(fetchError);
  const [filterApprovalStatus, setFilterApprovalStatus] = useState("");
  const [filterLandlordType, setFilterLandlordType] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(fetchError);
  }, [fetchError]);

  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      // Never hide the notification deep-link target behind list filters.
      if (highlightTenantId && row.tenantId === highlightTenantId) {
        return true;
      }
      if (
        filterApprovalStatus &&
        (row.approvalStatus ?? "") !== filterApprovalStatus
      ) {
        return false;
      }
      if (
        filterLandlordType &&
        (row.landlordType ?? "") !== filterLandlordType
      ) {
        return false;
      }
      return true;
    });
  }, [rows, filterApprovalStatus, filterLandlordType, highlightTenantId]);

  const highlightMissing =
    Boolean(highlightTenantId) &&
    !rows.some((row) => row.tenantId === highlightTenantId);

  useEffect(() => {
    if (!highlightTenantId || highlightMissing) {
      return;
    }
    const el = document.getElementById(`landlord-row-${highlightTenantId}`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightTenantId, highlightMissing, filteredRows]);

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch("/api/admin/landlords/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: form.address.trim(),
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      tenant_id?: string;
    } | null;

    if (!response.ok || !payload?.tenant_id) {
      setError(payload?.error ?? "Unable to create landlord.");
      setLoading(false);
      return;
    }

    setShowForm(false);
    setForm(emptyForm);
    setLoading(false);
    router.push(`/dashboard/real-estate/landlords/${payload.tenant_id}`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px]">
            <label
              htmlFor="landlord-filter-approval"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Approval Status
            </label>
            <select
              id="landlord-filter-approval"
              value={filterApprovalStatus}
              onChange={(event) => setFilterApprovalStatus(event.target.value)}
              className={inputClassName}
            >
              <option value="">All</option>
              {LANDLORD_APPROVAL_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[180px]">
            <label
              htmlFor="landlord-filter-type"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Landlord Type
            </label>
            <select
              id="landlord-filter-type"
              value={filterLandlordType}
              onChange={(event) => setFilterLandlordType(event.target.value)}
              className={inputClassName}
            >
              <option value="">All</option>
              {LANDLORD_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setForm(emptyForm);
            setShowForm((current) => !current);
            setError(null);
          }}
          className={primaryButtonClassName}
        >
          {showForm ? "Cancel" : "Add Landlord"}
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {highlightMissing ? <NotificationTargetUnavailableBanner /> : null}

      {showForm ? (
        <form
          onSubmit={handleCreate}
          className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
        >
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
            New Landlord
          </h3>
          <p className="text-sm text-slate-600">
            Creates a pending landlord tenant. Approve from the detail page when
            ready (portal invite is sent on approve).
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div>
              <label
                htmlFor="landlord-create-name"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Name
              </label>
              <input
                id="landlord-create-name"
                required
                type="text"
                value={form.name}
                onChange={(event) => updateField("name", event.target.value)}
                className={inputClassName}
              />
            </div>
            <div>
              <label
                htmlFor="landlord-create-email"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Email
              </label>
              <input
                id="landlord-create-email"
                required
                type="email"
                value={form.email}
                onChange={(event) => updateField("email", event.target.value)}
                className={inputClassName}
              />
            </div>
            <div>
              <label
                htmlFor="landlord-create-phone"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Phone
              </label>
              <input
                id="landlord-create-phone"
                required
                type="text"
                value={form.phone}
                onChange={(event) => updateField("phone", event.target.value)}
                className={inputClassName}
              />
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <label
                htmlFor="landlord-create-address"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Address
              </label>
              <input
                id="landlord-create-address"
                required
                type="text"
                value={form.address}
                onChange={(event) => updateField("address", event.target.value)}
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
              {loading ? "Saving…" : "Save Landlord"}
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
              <th className={scrollableTableThClassName}>Landlord Type</th>
              <th className={scrollableTableThClassName}>Approval Status</th>
              <th className={scrollableTableThClassName}>Subscription Tier</th>
              <th className={scrollableTableThClassName}>Created Date</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No landlords match the current filters.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => {
                const isHighlighted = highlightTenantId === row.tenantId;
                return (
                  <tr
                    key={row.tenantId}
                    id={`landlord-row-${row.tenantId}`}
                    className={
                      isHighlighted
                        ? "bg-amber-50 ring-2 ring-inset ring-amber-300"
                        : getStripedRowClassName(index)
                    }
                  >
                    <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                      <Link
                        href={`/dashboard/real-estate/landlords/${row.tenantId}`}
                        className="hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatLandlordType(row.landlordType)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatLandlordApprovalStatus(row.approvalStatus)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.landlordType === "davors_managed"
                        ? "—"
                        : formatLandlordTier(row.subscriptionTier)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatLandlordDate(row.createdAt)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
