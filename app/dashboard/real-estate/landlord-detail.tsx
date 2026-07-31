"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import {
  LANDLORD_TYPE_OPTIONS,
  formatLandlordApprovalStatus,
  formatLandlordDate,
  formatLandlordTier,
  type LandlordDetail,
  type LandlordType,
} from "./landlords-utils";

type LandlordDetailViewProps = {
  initialDetail: LandlordDetail;
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function formatMoney(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(Number(value))) {
    return "—";
  }
  return `GHS ${Number(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function LandlordDetailView({
  initialDetail,
  fetchError,
}: LandlordDetailViewProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [landlordType, setLandlordType] = useState<LandlordType | "">(
    initialDetail.landlordType ?? "",
  );
  const [managementFeePercent, setManagementFeePercent] = useState(
    initialDetail.managementFeePercent != null
      ? String(initialDetail.managementFeePercent)
      : "",
  );
  const [paystackSubaccountCode, setPaystackSubaccountCode] = useState(
    initialDetail.paystackSubaccountCode ?? "",
  );

  useEffect(() => {
    setDetail(initialDetail);
    setLandlordType(initialDetail.landlordType ?? "");
    setManagementFeePercent(
      initialDetail.managementFeePercent != null
        ? String(initialDetail.managementFeePercent)
        : "",
    );
    setPaystackSubaccountCode(initialDetail.paystackSubaccountCode ?? "");
  }, [initialDetail]);

  const showManagementFee = landlordType === "davors_managed";
  const isPending = detail.approvalStatus === "pending";

  async function saveEditableFields() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (!landlordType) {
      setError("Landlord type is required.");
      setLoading(false);
      return;
    }

    let feeValue: number | null = null;
    if (landlordType === "davors_managed") {
      const parsed = Number(managementFeePercent);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Enter a valid management fee percent.");
        setLoading(false);
        return;
      }
      feeValue = parsed;
    }

    const response = await fetch("/api/admin/landlords/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: detail.tenantId,
        landlord_type: landlordType,
        management_fee_percent: feeValue,
        paystack_subaccount_code: paystackSubaccountCode.trim() || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save landlord details.");
      setLoading(false);
      return;
    }

    setSuccess("Landlord details saved.");
    setLoading(false);
    router.refresh();
  }

  async function setApprovalStatus(status: "approved" | "rejected") {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const endpoint =
      status === "approved"
        ? "/api/admin/landlords/approve"
        : "/api/admin/landlords/reject";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_id: detail.tenantId }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(
        payload?.error ??
          `Unable to ${status === "approved" ? "approve" : "reject"} landlord.`,
      );
      setLoading(false);
      return;
    }

    setDetail((current) => ({ ...current, approvalStatus: status }));
    setSuccess(
      status === "approved" ? "Landlord approved." : "Landlord rejected.",
    );
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/real-estate/landlords"
          className="text-sm font-medium text-[#0f2744] hover:underline"
        >
          ← Back to Landlords
        </Link>
        {isPending ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButtonClassName}
              disabled={loading}
              onClick={() => void setApprovalStatus("approved")}
            >
              Approve
            </button>
            <button
              type="button"
              className={dangerButtonClassName}
              disabled={loading}
              onClick={() => void setApprovalStatus("rejected")}
            >
              Reject
            </button>
          </div>
        ) : null}
      </div>

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

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-semibold text-[#0f2744]">
          Tenant profile
        </h3>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Name
            </dt>
            <dd className="mt-1 text-sm text-slate-900">{detail.name}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Tenant code
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {detail.tenantCode ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Email
            </dt>
            <dd className="mt-1 text-sm text-slate-900">{detail.email ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Phone
            </dt>
            <dd className="mt-1 text-sm text-slate-900">{detail.phone ?? "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Address
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {detail.address ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Logo URL
            </dt>
            <dd className="mt-1 break-all text-sm text-slate-900">
              {detail.logoUrl ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Approval status
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {formatLandlordApprovalStatus(detail.approvalStatus)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              SMS credit balance
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {detail.smsCreditBalance != null
                ? detail.smsCreditBalance.toLocaleString("en-GH")
                : "—"}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-base font-semibold text-[#0f2744]">
          Editable landlord settings
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="landlord-type"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Landlord type
            </label>
            <select
              id="landlord-type"
              value={landlordType}
              onChange={(event) =>
                setLandlordType(event.target.value as LandlordType | "")
              }
              className={inputClassName}
            >
              <option value="" disabled>
                Select type
              </option>
              {LANDLORD_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {showManagementFee ? (
            <div>
              <label
                htmlFor="management-fee"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Management fee percent
              </label>
              <input
                id="management-fee"
                type="number"
                min="0"
                step="0.01"
                value={managementFeePercent}
                onChange={(event) => setManagementFeePercent(event.target.value)}
                className={inputClassName}
              />
            </div>
          ) : null}

          <div className={showManagementFee ? undefined : "sm:col-span-2"}>
            <label
              htmlFor="paystack-subaccount"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Paystack subaccount code
            </label>
            <input
              id="paystack-subaccount"
              type="text"
              value={paystackSubaccountCode}
              onChange={(event) => setPaystackSubaccountCode(event.target.value)}
              className={inputClassName}
              placeholder="ACCT_…"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={primaryButtonClassName}
            disabled={loading}
            onClick={() => void saveEditableFields()}
          >
            {loading ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={loading}
            onClick={() => {
              setLandlordType(detail.landlordType ?? "");
              setManagementFeePercent(
                detail.managementFeePercent != null
                  ? String(detail.managementFeePercent)
                  : "",
              );
              setPaystackSubaccountCode(detail.paystackSubaccountCode ?? "");
              setError(null);
              setSuccess(null);
            }}
          >
            Reset
          </button>
        </div>
      </section>

      {detail.landlordType === "platform_only" ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-base font-semibold text-[#0f2744]">
            Subscription (platform only)
          </h3>
          {detail.subscription ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Tier
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatLandlordTier(detail.subscription.tier)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Status
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {detail.subscription.status
                    ? detail.subscription.status
                        .replace(/_/g, " ")
                        .replace(/\b\w/g, (char) => char.toUpperCase())
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Trial ends
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatLandlordDate(detail.subscription.trialEndsAt)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Active units
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {detail.subscription.activeUnitCount != null
                    ? detail.subscription.activeUnitCount.toLocaleString("en-GH")
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Current period price
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatMoney(detail.subscription.currentPeriodPriceGhs)}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-slate-500">
              No landlord subscription record found for this tenant.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
