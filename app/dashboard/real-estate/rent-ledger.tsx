"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import type { LandlordListRow, LandlordType } from "./landlords-utils";
import {
  MANUAL_PAYMENT_METHOD_OPTIONS,
  RENT_LEDGER_STATUS_OPTIONS,
  formatRentLedgerStatus,
  formatRentMoney,
  formatRentPaymentMethod,
  formatRentPeriod,
  type RentLedgerListRow,
  type RentLedgerStatus,
  type RentPaymentMethod,
} from "./rent-ledger-utils";

type RentLedgerProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  landlordType: LandlordType | null;
  initialRows: RentLedgerListRow[];
  landlordsError: string | null;
  ledgerError: string | null;
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

export default function RentLedger({
  landlords,
  selectedLandlordId,
  landlordType,
  initialRows,
  landlordsError,
  ledgerError,
}: RentLedgerProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? ledgerError,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [recordingEntryId, setRecordingEntryId] = useState<string | null>(null);
  const [verifyingEntryId, setVerifyingEntryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [billingMonth, setBillingMonth] = useState(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<RentPaymentMethod>("cash");
  const [paymentDate, setPaymentDate] = useState(todayInputValue());
  const [paymentNotes, setPaymentNotes] = useState("");

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(landlordsError ?? ledgerError);
  }, [landlordsError, ledgerError]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );

  const filteredRows = useMemo(() => {
    if (!statusFilter) {
      return rows;
    }
    return rows.filter((row) => row.status === statusFilter);
  }, [rows, statusFilter]);

  function handleLandlordChange(tenantId: string) {
    setRecordingEntryId(null);
    setSuccess(null);
    if (!tenantId) {
      router.push("/dashboard/real-estate/rent-ledger");
      return;
    }
    router.push(
      `/dashboard/real-estate/rent-ledger?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  function openRecordPayment(row: RentLedgerListRow) {
    setError(null);
    setSuccess(null);
    setRecordingEntryId(row.entryId);
    setPaymentAmount("");
    setPaymentMethod("cash");
    setPaymentDate(todayInputValue());
    setPaymentNotes("");
  }

  async function handleRecordPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId || !recordingEntryId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/rent-ledger/record-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        entry_id: recordingEntryId,
        amount_paid_ghs: paymentAmount,
        payment_method: paymentMethod,
        payment_date: paymentDate,
        notes: paymentNotes || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to record payment.");
      setLoading(false);
      return;
    }

    setRecordingEntryId(null);
    setLoading(false);
    setSuccess("Payment recorded.");
    router.refresh();
  }

  async function handleVerifyPayment(entryId: string) {
    if (!selectedLandlordId) {
      return;
    }
    if (
      !window.confirm(
        "Confirm that this cash/bank transfer payment has been verified?",
      )
    ) {
      return;
    }

    setVerifyingEntryId(entryId);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/rent-ledger/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        entry_id: entryId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to verify payment.");
      setVerifyingEntryId(null);
      return;
    }

    setVerifyingEntryId(null);
    setSuccess("Payment verified.");
    router.refresh();
  }

  async function handleGenerateNow() {
    if (!selectedLandlordId) {
      return;
    }

    const month = billingMonth.trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Billing month must be YYYY-MM.");
      return;
    }

    setGenerating(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/rent-ledger/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        billingMonth: month,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      created?: number;
      skipped?: number;
      errors?: number;
      overdueUpdated?: number;
      billingMonth?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to generate rent ledger.");
      setGenerating(false);
      return;
    }

    setGenerating(false);
    setSuccess(
      `Generated ${payload?.billingMonth ?? month}: ${payload?.created ?? 0} created, ${payload?.skipped ?? 0} skipped, ${payload?.errors ?? 0} errors${
        payload?.overdueUpdated
          ? `, ${payload.overdueUpdated} marked overdue`
          : ""
      }.`,
    );
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label
          htmlFor="rent-ledger-landlord-picker"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Landlord
        </label>
        <select
          id="rent-ledger-landlord-picker"
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
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      {!selectedLandlordId ? (
        <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-700">
            Select a landlord to view their rent ledger.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-slate-600">
                Rent ledger for{" "}
                <span className="font-medium text-[#0f2744]">
                  {selectedLandlord?.name ?? "selected landlord"}
                </span>
              </p>
              {landlordType === "davors_managed" ? (
                <p className="mt-1 text-xs text-slate-500">
                  Davors-managed landlord — cash/bank payments require
                  verification.
                </p>
              ) : landlordType === "platform_only" ? (
                <p className="mt-1 text-xs text-slate-500">
                  Platform-only landlord — manual payments are trusted without
                  verification.
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[140px]">
                <label
                  htmlFor="rent-ledger-billing-month"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Billing month
                </label>
                <input
                  id="rent-ledger-billing-month"
                  type="month"
                  value={billingMonth}
                  onChange={(event) => setBillingMonth(event.target.value)}
                  className={inputClassName}
                />
              </div>
              <button
                type="button"
                disabled={generating}
                onClick={() => void handleGenerateNow()}
                className={primaryButtonClassName}
              >
                {generating ? "Generating…" : "Generate Now"}
              </button>
              <div className="min-w-[180px]">
                <label
                  htmlFor="rent-ledger-status-filter"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Status
                </label>
                <select
                  id="rent-ledger-status-filter"
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(event.target.value as RentLedgerStatus | "")
                  }
                  className={inputClassName}
                >
                  <option value="">All</option>
                  {RENT_LEDGER_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {recordingEntryId ? (
            <form
              onSubmit={handleRecordPayment}
              className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
                Record Payment
              </h3>
              <p className="text-sm text-slate-600">
                This amount is added to any existing amount paid on the entry.
              </p>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Amount Paid (GHS)
                  </label>
                  <input
                    required
                    type="number"
                    min={0.01}
                    step="0.01"
                    value={paymentAmount}
                    onChange={(event) => setPaymentAmount(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Payment Method
                  </label>
                  <select
                    required
                    value={paymentMethod}
                    onChange={(event) =>
                      setPaymentMethod(event.target.value as RentPaymentMethod)
                    }
                    className={inputClassName}
                  >
                    {MANUAL_PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Payment Date
                  </label>
                  <input
                    required
                    type="date"
                    value={paymentDate}
                    onChange={(event) => setPaymentDate(event.target.value)}
                    className={inputClassName}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes (optional)
                </label>
                <textarea
                  rows={3}
                  value={paymentNotes}
                  onChange={(event) => setPaymentNotes(event.target.value)}
                  className={textareaClassName}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={primaryButtonClassName}
                >
                  {loading ? "Saving…" : "Save Payment"}
                </button>
                <button
                  type="button"
                  onClick={() => setRecordingEntryId(null)}
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
                  <th className={scrollableTableThClassName}>Tenant</th>
                  <th className={scrollableTableThClassName}>Unit</th>
                  <th className={scrollableTableThClassName}>Period</th>
                  <th className={scrollableTableThClassName}>Amount Due</th>
                  <th className={scrollableTableThClassName}>Amount Paid</th>
                  <th className={scrollableTableThClassName}>
                    Outstanding Balance
                  </th>
                  <th className={scrollableTableThClassName}>Status</th>
                  <th className={scrollableTableThClassName}>Payment Method</th>
                  <th className={scrollableTableThClassName}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      No rent ledger entries match the current filters.
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row, index) => (
                    <tr
                      key={row.entryId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                        {row.tenantName}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {row.unitLabel}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentPeriod(row.periodStart, row.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentMoney(row.amountDueGhs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentMoney(row.amountPaidGhs)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentMoney(
                          Math.max(row.amountDueGhs - row.amountPaidGhs, 0),
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        <div className="flex flex-col gap-1">
                          <span>{formatRentLedgerStatus(row.status)}</span>
                          {row.verificationStatus ===
                          "pending_verification" ? (
                            <span className="inline-flex w-fit rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                              Pending verification
                            </span>
                          ) : null}
                          {row.verificationStatus === "verified" ? (
                            <span className="inline-flex w-fit rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900">
                              Verified
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatRentPaymentMethod(row.paymentMethod)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex flex-wrap gap-3">
                          {row.status !== "paid" ? (
                            <button
                              type="button"
                              onClick={() => openRecordPayment(row)}
                              className="text-[#0f2744] hover:underline"
                            >
                              Record Payment
                            </button>
                          ) : null}
                          {row.verificationStatus ===
                          "pending_verification" ? (
                            <button
                              type="button"
                              disabled={verifyingEntryId === row.entryId}
                              onClick={() => handleVerifyPayment(row.entryId)}
                              className="text-[#0f2744] hover:underline disabled:opacity-50"
                            >
                              {verifyingEntryId === row.entryId
                                ? "Verifying…"
                                : "Verify Payment"}
                            </button>
                          ) : null}
                        </div>
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
