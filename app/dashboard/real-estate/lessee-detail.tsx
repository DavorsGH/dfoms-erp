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
import {
  formatDepositStatus,
  formatLeaseDate,
  formatLeaseMoney,
  formatLeaseStatus,
} from "./leases-utils";
import {
  formatInspectionDate,
  formatInspectionType,
} from "./inspections-utils";
import {
  formatMaintenanceDate,
  formatMaintenanceMoney,
  formatMaintenanceStatus,
} from "./maintenance-utils";
import {
  formatRentDate,
  formatRentLedgerStatus,
  formatRentMoney,
  formatRentPaymentMethod,
  formatRentPeriod,
} from "./rent-ledger-utils";
import {
  LESSEE_STATUS_OPTIONS,
  formatLesseeDate,
  formatLesseeStatus,
  type LesseeDetail,
  type LesseeStatus,
} from "./lessees-utils";

type LesseeDetailViewProps = {
  initialDetail: LesseeDetail;
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const sectionClassName =
  "rounded-md border border-slate-200 bg-white p-4";

const sectionTitleClassName =
  "text-sm font-semibold uppercase tracking-wide text-[#0f2744]";

export default function LesseeDetailView({
  initialDetail,
  fetchError,
}: LesseeDetailViewProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(initialDetail.fullName);
  const [phone, setPhone] = useState(initialDetail.phone);
  const [email, setEmail] = useState(initialDetail.email ?? "");
  const [status, setStatus] = useState<LesseeStatus>(initialDetail.status);
  const [privateNotes, setPrivateNotes] = useState(
    initialDetail.privateNotes ?? "",
  );

  useEffect(() => {
    setDetail(initialDetail);
    setFullName(initialDetail.fullName);
    setPhone(initialDetail.phone);
    setEmail(initialDetail.email ?? "");
    setStatus(initialDetail.status);
    setPrivateNotes(initialDetail.privateNotes ?? "");
    setError(fetchError);
    setEditing(false);
  }, [initialDetail, fetchError]);

  async function handleProfilePhotoUpload(file: File) {
    setUploadingPhoto(true);
    setError(null);
    setSuccess(null);

    const formData = new FormData();
    formData.set("tenant_id", detail.tenantId);
    formData.set("lessee_id", detail.lesseeId);
    formData.set("file", file);

    const response = await fetch("/api/admin/lessees/upload-photo", {
      method: "POST",
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      photo_url?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to upload profile photo.");
      setUploadingPhoto(false);
      return;
    }

    const nextUrl = payload?.photo_url ?? null;
    if (nextUrl) {
      setDetail((current) => ({ ...current, photoUrl: nextUrl }));
    }
    setSuccess("Profile photo updated.");
    setUploadingPhoto(false);
    router.refresh();
  }

  const backHref = `/dashboard/real-estate/lessees?landlord=${encodeURIComponent(detail.tenantId)}`;
  const rentLedgerHref = `/dashboard/real-estate/rent-ledger?landlord=${encodeURIComponent(detail.tenantId)}`;
  const maintenanceHref = `/dashboard/real-estate/maintenance?landlord=${encodeURIComponent(detail.tenantId)}`;
  const inspectionsHref = `/dashboard/real-estate/inspections?landlord=${encodeURIComponent(detail.tenantId)}`;

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/lessees/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: detail.tenantId,
        lessee_id: detail.lesseeId,
        full_name: fullName,
        phone,
        email: email.trim() || null,
        status,
        private_notes: privateNotes.trim() || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update tenant.");
      setSaving(false);
      return;
    }

    setSaving(false);
    setEditing(false);
    setSuccess("Tenant updated.");
    router.refresh();
  }

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={backHref}
          className="text-sm font-medium text-[#0f2744] hover:underline"
        >
          ← Back to Tenants
        </Link>
        <p className="mt-2 text-sm text-slate-600">
          Landlord:{" "}
          <span className="font-medium text-[#0f2744]">
            {detail.landlordName}
          </span>
        </p>
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

      {/* Hero: details left, property photo top-right */}
      <section className={sectionClassName}>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={sectionTitleClassName}>Tenant details</h3>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className={secondaryButtonClassName}
                >
                  Edit
                </button>
              ) : null}
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <div className="shrink-0">
                {detail.photoUrl ? (
                  <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={detail.photoUrl}
                      alt={`${detail.fullName} profile`}
                      className="h-28 w-28 object-cover"
                    />
                  </div>
                ) : (
                  <div className="flex h-28 w-28 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-center text-xs text-slate-500">
                    No photo
                  </div>
                )}
                {editing ? (
                  <div className="mt-2">
                    <label className="block text-xs font-medium text-slate-600">
                      {detail.photoUrl ? "Change photo" : "Upload photo"}
                    </label>
                    <input
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp"
                      disabled={uploadingPhoto || saving}
                      className="mt-1 block w-full max-w-[7rem] text-xs text-slate-700"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) {
                          void handleProfilePhotoUpload(file);
                        }
                      }}
                    />
                    {uploadingPhoto ? (
                      <p className="mt-1 text-xs text-slate-500">Uploading…</p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="min-w-0 flex-1">
                {!editing ? (
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Full name
                      </dt>
                      <dd className="mt-1 text-sm text-slate-900">
                        {detail.fullName}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Status
                      </dt>
                      <dd className="mt-1 text-sm text-slate-900">
                        {formatLesseeStatus(detail.status)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Phone
                      </dt>
                      <dd className="mt-1 text-sm text-slate-900">
                        {detail.phone}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Email
                      </dt>
                      <dd className="mt-1 text-sm text-slate-900">
                        {detail.email ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                        Created
                      </dt>
                      <dd className="mt-1 text-sm text-slate-900">
                        {formatLesseeDate(detail.createdAt)}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <form
                    onSubmit={(event) => void handleSave(event)}
                    className="space-y-4"
                  >
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                          Full name
                        </label>
                        <input
                          required
                          type="text"
                          value={fullName}
                          onChange={(event) => setFullName(event.target.value)}
                          className={inputClassName}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                          Status
                        </label>
                        <select
                          value={status}
                          onChange={(event) =>
                            setStatus(event.target.value as LesseeStatus)
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
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                          Phone
                        </label>
                        <input
                          required
                          type="text"
                          value={phone}
                          onChange={(event) => setPhone(event.target.value)}
                          className={inputClassName}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                          Email
                        </label>
                        <input
                          type="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          className={inputClassName}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Private / Internal Notes
                      </label>
                      <textarea
                        rows={3}
                        value={privateNotes}
                        onChange={(event) =>
                          setPrivateNotes(event.target.value)
                        }
                        className={textareaClassName}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={saving || uploadingPhoto}
                        className={primaryButtonClassName}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={saving || uploadingPhoto}
                        onClick={() => {
                          setEditing(false);
                          setFullName(detail.fullName);
                          setPhone(detail.phone);
                          setEmail(detail.email ?? "");
                          setStatus(detail.status);
                          setPrivateNotes(detail.privateNotes ?? "");
                        }}
                        className={secondaryButtonClassName}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>

            {!editing && detail.privateNotes?.trim() ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Private / Internal Notes
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-amber-950">
                  {detail.privateNotes}
                </p>
              </div>
            ) : null}
          </div>

          <div className="w-full shrink-0 lg:w-[340px] xl:w-[400px]">
            {detail.propertyHeroPhotoUrl ? (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={detail.propertyHeroPhotoUrl}
                  alt={
                    detail.propertyHeroPropertyName
                      ? `${detail.propertyHeroPropertyName} property`
                      : "Rented property"
                  }
                  className="aspect-[4/3] w-full object-cover"
                />
                <div className="border-t border-slate-200 bg-white px-3 py-2">
                  <p className="text-sm font-medium text-[#0f2744]">
                    {detail.propertyHeroPropertyName ?? "Property"}
                  </p>
                  {detail.propertyHeroPropertyId ? (
                    <Link
                      href={`/dashboard/real-estate/properties/${detail.tenantId}/${detail.propertyHeroPropertyId}`}
                      className="mt-1 inline-block text-xs font-medium text-[#0f2744] hover:underline"
                    >
                      View property →
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex aspect-[4/3] w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center text-sm text-slate-500">
                {detail.activeLease
                  ? "No property photo uploaded yet."
                  : "No active lease — no property photo."}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={sectionClassName}>
        <h3 className={sectionTitleClassName}>Active lease</h3>
        {!detail.activeLease ? (
          <p className="mt-3 text-sm text-slate-600">
            No lease on file for this tenant.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Property / Unit
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {detail.activeLease.propertyName} —{" "}
                  {detail.activeLease.unitNumber}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Rent
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatLeaseMoney(detail.activeLease.rentAmountGhs)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Status
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatLeaseStatus(detail.activeLease.status)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Start
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatLeaseDate(detail.activeLease.startDate)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  End
                </dt>
                <dd className="mt-1 text-sm text-slate-900">
                  {formatLeaseDate(detail.activeLease.endDate)}
                </dd>
              </div>
            </dl>
            <Link
              href={`/dashboard/real-estate/leases/${detail.tenantId}/${detail.activeLease.leaseId}`}
              className="inline-block text-sm font-medium text-[#0f2744] hover:underline"
            >
              Open lease detail →
            </Link>
            {detail.leases.length > 1 ? (
              <div className="pt-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  All leases ({detail.leases.length})
                </p>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {detail.leases.map((lease) => (
                    <li key={lease.leaseId}>
                      <Link
                        href={`/dashboard/real-estate/leases/${detail.tenantId}/${lease.leaseId}`}
                        className="text-[#0f2744] hover:underline"
                      >
                        {lease.propertyName} — {lease.unitNumber}
                      </Link>
                      <span className="text-slate-500">
                        {" "}
                        · {formatLeaseStatus(lease.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>

      <section className={sectionClassName}>
        <h3 className={sectionTitleClassName}>Security deposit</h3>
        {detail.deposits.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No security deposits on file.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Amount</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Collected</th>
                  <th className={scrollableTableThClassName}>Resolved</th>
                  <th className={scrollableTableThClassName}></th>
                </tr>
              </thead>
              <tbody>
                {detail.deposits.map((deposit, index) => (
                  <tr
                    key={deposit.depositId}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {deposit.unitLabel}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatLeaseMoney(deposit.amountGhs)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatDepositStatus(deposit.status)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatLeaseDate(deposit.dateCollected)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatLeaseDate(deposit.dateResolved)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/dashboard/real-estate/leases/${detail.tenantId}/${deposit.leaseId}?resolveDeposit=1`}
                        className="text-[#0f2744] hover:underline"
                      >
                        Open on lease →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={sectionClassName}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleClassName}>Rent payment history</h3>
          <Link
            href={rentLedgerHref}
            className="text-sm font-medium text-[#0f2744] hover:underline"
          >
            Full rent ledger →
          </Link>
        </div>
        {detail.rentLedger.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No rent ledger entries.</p>
        ) : (
          <div className="mt-3">
            <ScrollableTable>
              <table className={scrollableTableClassName}>
                <thead className={scrollableTableHeadClassName}>
                  <tr>
                    <th className={scrollableTableThClassName}>Period</th>
                    <th className={scrollableTableThClassName}>Unit</th>
                    <th className={scrollableTableThClassName}>Due</th>
                    <th className={scrollableTableThClassName}>Paid</th>
                    <th className={scrollableTableThClassName}>Status</th>
                    <th className={scrollableTableThClassName}>Method</th>
                    <th className={scrollableTableThClassName}>Paid on</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.rentLedger.map((row, index) => (
                    <tr
                      key={row.entryId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentPeriod(row.periodStart, row.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.unitLabel}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentMoney(row.amountDueGhs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentMoney(row.amountPaidGhs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentLedgerStatus(row.status)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentPaymentMethod(row.paymentMethod)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentDate(row.paymentDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableTable>
          </div>
        )}
      </section>

      <section className={sectionClassName}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleClassName}>Maintenance requests</h3>
          <Link
            href={maintenanceHref}
            className="text-sm font-medium text-[#0f2744] hover:underline"
          >
            Maintenance tab →
          </Link>
        </div>
        {detail.maintenance.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No maintenance requests.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Reported</th>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Description</th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {detail.maintenance.map((row, index) => (
                  <tr
                    key={row.requestId}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatMaintenanceDate(row.dateReported)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.unitLabel}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-sm text-slate-700">
                      {row.description}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatMaintenanceStatus(row.status)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatMaintenanceMoney(row.costGhs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={sectionClassName}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className={sectionTitleClassName}>Inspections</h3>
          <Link
            href={inspectionsHref}
            className="text-sm font-medium text-[#0f2744] hover:underline"
          >
            Inspections tab →
          </Link>
        </div>
        {detail.inspections.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No inspections.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={scrollableTableThClassName}>Date</th>
                  <th className={scrollableTableThClassName}>Type</th>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Conducted by</th>
                  <th className={scrollableTableThClassName}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {detail.inspections.map((row, index) => (
                  <tr
                    key={row.inspectionId}
                    className={getStripedRowClassName(index)}
                  >
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatInspectionDate(row.inspectionDate)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {formatInspectionType(row.inspectionType)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.unitLabel}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700">
                      {row.conductedBy ?? "—"}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-sm text-slate-700">
                      {row.notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
