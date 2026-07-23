"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CrmProductEntry } from "../crm/products/products-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import type { CustomerTenantRow } from "@/utils/tenant-management";

type TenantManagementProps = {
  initialRows: CustomerTenantRow[];
  tierOptions: CrmProductEntry[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const actionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const primaryActionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-[#0f2744] px-2 py-1 text-xs font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function formatSignupDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTrialEndDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatSubscriptionStatus(value: string | null): string {
  if (!value) {
    return "—";
  }

  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatWaiverAt(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function TenantManagement({
  initialRows,
  tierOptions,
  fetchError,
}: TenantManagementProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(fetchError);
  const [loadingTenantId, setLoadingTenantId] = useState<string | null>(null);
  const [changeTierTenant, setChangeTierTenant] = useState<CustomerTenantRow | null>(
    null,
  );
  const [selectedProductId, setSelectedProductId] = useState("");
  const [waiveTenant, setWaiveTenant] = useState<CustomerTenantRow | null>(null);
  const [waiveReason, setWaiveReason] = useState("");

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  async function refreshRows() {
    router.refresh();
  }

  async function updateTenantStatus(
    tenantId: string,
    status: "active" | "suspended",
  ) {
    setLoadingTenantId(tenantId);
    setError(null);

    const response = await fetch("/api/admin/tenants/update-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: tenantId, status }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update tenant status.");
      setLoadingTenantId(null);
      return;
    }

    setRows((current) =>
      current.map((row) =>
        row.tenantId === tenantId ? { ...row, tenantStatus: status } : row,
      ),
    );
    setLoadingTenantId(null);
    await refreshRows();
  }

  async function handleSuspend(row: CustomerTenantRow) {
    if (
      !window.confirm(
        `Suspend ${row.companyName}? Users in this tenant will be blocked from accessing the dashboard.`,
      )
    ) {
      return;
    }

    await updateTenantStatus(row.tenantId, "suspended");
  }

  async function handleReactivate(row: CustomerTenantRow) {
    if (!window.confirm(`Reactivate ${row.companyName}?`)) {
      return;
    }

    await updateTenantStatus(row.tenantId, "active");
  }

  function openChangeTier(row: CustomerTenantRow) {
    setWaiveTenant(null);
    setChangeTierTenant(row);
    setSelectedProductId(row.productId ?? tierOptions[0]?.id ?? "");
    setError(null);
  }

  function closeChangeTier() {
    setChangeTierTenant(null);
    setSelectedProductId("");
  }

  function openWaiveBilling(row: CustomerTenantRow) {
    setChangeTierTenant(null);
    setWaiveTenant(row);
    setWaiveReason(row.billingWaivedReason ?? "");
    setError(null);
  }

  function closeWaiveBilling() {
    setWaiveTenant(null);
    setWaiveReason("");
  }

  async function handleChangeTierSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!changeTierTenant || !selectedProductId) {
      setError("Select a tier before confirming.");
      return;
    }

    setLoadingTenantId(changeTierTenant.tenantId);
    setError(null);

    const response = await fetch("/api/admin/tenants/mark-active", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: changeTierTenant.tenantId,
        product_id: selectedProductId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(
        payload?.error ??
          (changeTierTenant.subscriptionStatus === "active"
            ? "Unable to update tier."
            : "Unable to mark subscription active."),
      );
      setLoadingTenantId(null);
      return;
    }

    closeChangeTier();
    setLoadingTenantId(null);
    await refreshRows();
  }

  async function handleWaiveSubmit(event: React.FormEvent) {
    event.preventDefault();

    if (!waiveTenant) {
      return;
    }

    const reason = waiveReason.trim();
    if (!reason) {
      setError("A reason is required when waiving billing.");
      return;
    }

    setLoadingTenantId(waiveTenant.tenantId);
    setError(null);

    const response = await fetch("/api/admin/tenants/waive-billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: waiveTenant.tenantId,
        waived: true,
        reason,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to waive billing.");
      setLoadingTenantId(null);
      return;
    }

    closeWaiveBilling();
    setLoadingTenantId(null);
    await refreshRows();
  }

  async function handleUnwaive(row: CustomerTenantRow) {
    if (
      !window.confirm(
        `Remove the billing waiver for ${row.companyName}? Normal trial/subscription rules will apply again.`,
      )
    ) {
      return;
    }

    setLoadingTenantId(row.tenantId);
    setError(null);

    const response = await fetch("/api/admin/tenants/waive-billing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: row.tenantId,
        waived: false,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to remove billing waiver.");
      setLoadingTenantId(null);
      return;
    }

    setLoadingTenantId(null);
    await refreshRows();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Manage customer tenants created through self-serve signup. The Davors
        platform tenant is excluded from this list.
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {changeTierTenant ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold text-[#0f2744]">
            Change Tier — {changeTierTenant.companyName}
          </h3>
          <p className="mb-4 text-sm text-slate-600">
            {changeTierTenant.subscriptionStatus === "active"
              ? "Update this tenant's subscription tier."
              : "Assign a tier and set this tenant's subscription to active. Use this for manual billing or after a trial ends."}
          </p>
          <form onSubmit={handleChangeTierSubmit} className="max-w-md space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Tier
              </label>
              <select
                required
                value={selectedProductId}
                onChange={(event) => setSelectedProductId(event.target.value)}
                className={inputClassName}
              >
                <option value="">Select tier</option>
                {tierOptions.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loadingTenantId === changeTierTenant.tenantId}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingTenantId === changeTierTenant.tenantId
                  ? "Saving…"
                  : changeTierTenant.subscriptionStatus === "active"
                    ? "Save Tier"
                    : "Confirm Active"}
              </button>
              <button
                type="button"
                onClick={closeChangeTier}
                disabled={loadingTenantId === changeTierTenant.tenantId}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {waiveTenant ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-lg font-semibold text-[#0f2744]">
            Waive Billing — {waiveTenant.companyName}
          </h3>
          <p className="mb-4 text-sm text-slate-600">
            Exempt this tenant from billing. They keep full access as if paid;
            no charges will be attempted while the waiver is active.
          </p>
          <form onSubmit={handleWaiveSubmit} className="max-w-lg space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Reason (required)
              </label>
              <textarea
                required
                rows={3}
                value={waiveReason}
                onChange={(event) => setWaiveReason(event.target.value)}
                className={inputClassName}
                placeholder="e.g. Partner comp — Q3 2026"
              />
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loadingTenantId === waiveTenant.tenantId}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loadingTenantId === waiveTenant.tenantId
                  ? "Saving…"
                  : "Confirm Waiver"}
              </button>
              <button
                type="button"
                onClick={closeWaiveBilling}
                disabled={loadingTenantId === waiveTenant.tenantId}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Company</th>
              <th className={scrollableTableThClassName}>Signup Date</th>
              <th className={scrollableTableThClassName}>Tenant Status</th>
              <th className={scrollableTableThClassName}>Subscription</th>
              <th className={scrollableTableThClassName}>Trial End</th>
              <th className={scrollableTableThClassName}>Billing Waiver</th>
              <th className={scrollableTableThClassName}>Current Tier</th>
              <th className={scrollableTableThClassName}>Contact Email</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No customer tenants found.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const isLoading = loadingTenantId === row.tenantId;
                const canChangeTier = Boolean(row.subscriptionId);
                const canWaive = Boolean(row.subscriptionId);

                return (
                  <tr key={row.tenantId} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {row.companyName}
                    </td>
                    <td className="px-4 py-3">{formatSignupDate(row.signupDate)}</td>
                    <td className="px-4 py-3 capitalize">{row.tenantStatus}</td>
                    <td className="px-4 py-3">
                      {formatSubscriptionStatus(row.subscriptionStatus)}
                    </td>
                    <td className="px-4 py-3">
                      {formatTrialEndDate(row.trialEndDate)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {row.billingWaived ? (
                        <div className="space-y-1">
                          <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-900">
                            Waived
                          </span>
                          <p className="text-slate-700">
                            {row.billingWaivedReason ?? "—"}
                          </p>
                          <p className="text-xs text-slate-500">
                            by {row.billingWaivedBy ?? "—"} ·{" "}
                            {formatWaiverAt(row.billingWaivedAt)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-500">Not waived</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.tierName ?? "None selected"}
                    </td>
                    <td className="px-4 py-3">{row.contactEmail ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {row.tenantStatus === "active" ? (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => handleSuspend(row)}
                            className={actionButtonClassName}
                          >
                            Suspend
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => handleReactivate(row)}
                            className={primaryActionButtonClassName}
                          >
                            Reactivate
                          </button>
                        )}
                        {canChangeTier ? (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => openChangeTier(row)}
                            className={primaryActionButtonClassName}
                          >
                            Change Tier
                          </button>
                        ) : null}
                        {canWaive && !row.billingWaived ? (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => openWaiveBilling(row)}
                            className={primaryActionButtonClassName}
                          >
                            Waive Billing
                          </button>
                        ) : null}
                        {canWaive && row.billingWaived ? (
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => handleUnwaive(row)}
                            className={actionButtonClassName}
                          >
                            Un-waive
                          </button>
                        ) : null}
                      </div>
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
