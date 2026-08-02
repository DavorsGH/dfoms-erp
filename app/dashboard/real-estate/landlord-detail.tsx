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
  const [notificationPhone, setNotificationPhone] = useState(
    initialDetail.notificationPhone ?? initialDetail.phone ?? "",
  );
  const [notificationEmail, setNotificationEmail] = useState(
    initialDetail.email ?? "",
  );
  const [showConvertForm, setShowConvertForm] = useState(false);
  const [convertFeePercent, setConvertFeePercent] = useState("");
  const [converting, setConverting] = useState(false);

  useEffect(() => {
    setDetail(initialDetail);
    setLandlordType(initialDetail.landlordType ?? "");
    setManagementFeePercent(
      initialDetail.managementFeePercent != null
        ? String(initialDetail.managementFeePercent)
        : "",
    );
    setPaystackSubaccountCode(initialDetail.paystackSubaccountCode ?? "");
    setNotificationPhone(
      initialDetail.notificationPhone ?? initialDetail.phone ?? "",
    );
    setNotificationEmail(initialDetail.email ?? "");
    setShowConvertForm(false);
    setConvertFeePercent("");
  }, [initialDetail]);

  const showManagementFee = landlordType === "davors_managed";
  const isPending = detail.approvalStatus === "pending";
  const canConvertToDavorsManaged = detail.landlordType === "platform_only";

  async function saveEditableFields() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    if (!landlordType) {
      setError("Landlord type is required.");
      setLoading(false);
      return;
    }

    const trimmedEmail = notificationEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError("Enter a valid notification email address.");
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
        notification_phone: notificationPhone.trim() || null,
        notification_email: trimmedEmail || null,
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

  async function convertToDavorsManaged(event: React.FormEvent) {
    event.preventDefault();
    setConverting(true);
    setError(null);
    setSuccess(null);

    const fee = Number(convertFeePercent);
    if (!Number.isFinite(fee) || fee < 0 || convertFeePercent.trim() === "") {
      setError("Enter a management fee percent for this landlord.");
      setConverting(false);
      return;
    }

    const response = await fetch(
      "/api/admin/landlords/convert-to-davors-managed",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: detail.tenantId,
          management_fee_percent: fee,
        }),
      },
    );

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(
        payload?.error ?? "Unable to convert landlord to Davors-managed.",
      );
      setConverting(false);
      return;
    }

    setShowConvertForm(false);
    setConvertFeePercent("");
    setConverting(false);
    setSuccess(
      "Landlord converted to Davors-managed. They will now appear in managed property pickers.",
    );
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
          Landlord profile
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
            <p className="mt-1 text-xs text-slate-500">
              Editable below as notification email.
            </p>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Phone
            </dt>
            <dd className="mt-1 text-sm text-slate-900">
              {detail.notificationPhone ?? detail.phone ?? "—"}
            </dd>
            <p className="mt-1 text-xs text-slate-500">
              Editable below as notification phone.
            </p>
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

          <div>
            <label
              htmlFor="notification-phone"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Notification phone
            </label>
            <input
              id="notification-phone"
              type="text"
              value={notificationPhone}
              onChange={(event) => setNotificationPhone(event.target.value)}
              className={inputClassName}
              placeholder="e.g. 0241234567"
            />
            <p className="mt-1 text-xs text-slate-500">
              Used for Real Estate ops SMS when this landlord is Platform Only.
            </p>
          </div>

          <div>
            <label
              htmlFor="notification-email"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Notification email
            </label>
            <input
              id="notification-email"
              type="email"
              value={notificationEmail}
              onChange={(event) => setNotificationEmail(event.target.value)}
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500">
              Reuses the tenant email. Used for ops alerts when Platform Only.
            </p>
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
              setNotificationPhone(
                detail.notificationPhone ?? detail.phone ?? "",
              );
              setNotificationEmail(detail.email ?? "");
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

      {canConvertToDavorsManaged ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-2 text-base font-semibold text-[#0f2744]">
            Convert to Davors-Managed
          </h3>
          <p className="mb-4 text-sm text-slate-600">
            Move this platform-only landlord onto Davors-managed operations with
            a management fee. Platform subscription billing will be cancelled.
          </p>

          {!showConvertForm ? (
            <button
              type="button"
              className={primaryButtonClassName}
              disabled={loading || converting}
              onClick={() => {
                setShowConvertForm(true);
                setConvertFeePercent("");
                setError(null);
                setSuccess(null);
              }}
            >
              Convert to Davors-Managed
            </button>
          ) : (
            <form onSubmit={convertToDavorsManaged} className="space-y-4">
              <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                This only affects rent collected going forward. Existing rent
                history, payments, and payouts stay exactly as they are — no
                retroactive escrow entries or fee deductions will be created.
              </div>

              <div className="max-w-xs">
                <label
                  htmlFor="convert-management-fee"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Management fee percent
                </label>
                <input
                  id="convert-management-fee"
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  value={convertFeePercent}
                  onChange={(event) => setConvertFeePercent(event.target.value)}
                  className={inputClassName}
                  placeholder="e.g. 10"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Enter the rate for this landlord (for example 10 for 10%). No
                  default is applied.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className={primaryButtonClassName}
                  disabled={converting || loading}
                >
                  {converting ? "Converting…" : "Confirm conversion"}
                </button>
                <button
                  type="button"
                  className={secondaryButtonClassName}
                  disabled={converting}
                  onClick={() => {
                    setShowConvertForm(false);
                    setConvertFeePercent("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </section>
      ) : null}
    </div>
  );
}
