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

type BulkGenerateLandlordResult = {
  tenantId: string;
  landlordName: string | null;
  ok: boolean;
  error?: string;
  created: number;
  skipped: number;
  errors: number;
  overdueUpdated: number;
};

type BulkGenerateSummary = {
  billingMonth: string;
  landlordsProcessed: number;
  created: number;
  skipped: number;
  errors: number;
  overdueUpdated: number;
  landlords: BulkGenerateLandlordResult[];
};

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
  const [selectedGenerateIds, setSelectedGenerateIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkGenerateSummary | null>(null);
  const [showBulkBreakdown, setShowBulkBreakdown] = useState(false);

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

  const allGenerateSelected =
    landlords.length > 0 &&
    landlords.every((landlord) => selectedGenerateIds.has(landlord.tenantId));

  const selectedGenerateCount = selectedGenerateIds.size;

  function toggleGenerateLandlord(tenantId: string) {
    setSelectedGenerateIds((current) => {
      const next = new Set(current);
      if (next.has(tenantId)) {
        next.delete(tenantId);
      } else {
        next.add(tenantId);
      }
      return next;
    });
  }

  function toggleSelectAllGenerateLandlords() {
    if (allGenerateSelected) {
      setSelectedGenerateIds(new Set());
      return;
    }
    setSelectedGenerateIds(new Set(landlords.map((landlord) => landlord.tenantId)));
  }

  function requestBulkGenerate() {
    const month = billingMonth.trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      setError("Billing month must be YYYY-MM.");
      return;
    }
    if (selectedGenerateCount === 0) {
      setError("Select at least one landlord to generate rent ledger entries.");
      return;
    }
    setError(null);
    setSuccess(null);
    setBulkConfirmOpen(true);
  }

  async function handleBulkGenerateConfirmed() {
    const month = billingMonth.trim();
    const tenantIds = [...selectedGenerateIds];
    setBulkConfirmOpen(false);
    setBulkGenerating(true);
    setError(null);
    setSuccess(null);
    setBulkResult(null);
    setShowBulkBreakdown(false);

    const response = await fetch("/api/admin/rent-ledger/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_ids: tenantIds,
        billingMonth: month,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      bulk?: boolean;
      billingMonth?: string;
      landlordsProcessed?: number;
      created?: number;
      skipped?: number;
      errors?: number;
      overdueUpdated?: number;
      landlords?: BulkGenerateLandlordResult[];
    } | null;

    setBulkGenerating(false);

    if (!response.ok || !payload?.bulk) {
      setError(payload?.error ?? "Unable to generate rent ledger in bulk.");
      return;
    }

    const summary: BulkGenerateSummary = {
      billingMonth: payload.billingMonth ?? month,
      landlordsProcessed: payload.landlordsProcessed ?? tenantIds.length,
      created: payload.created ?? 0,
      skipped: payload.skipped ?? 0,
      errors: payload.errors ?? 0,
      overdueUpdated: payload.overdueUpdated ?? 0,
      landlords: payload.landlords ?? [],
    };
    setBulkResult(summary);
    setShowBulkBreakdown(summary.landlords.length > 1);
    setSuccess(
      `${summary.landlordsProcessed} landlord${summary.landlordsProcessed === 1 ? "" : "s"} processed for ${summary.billingMonth}: ${summary.created} created, ${summary.skipped} skipped, ${summary.errors} errors${
        summary.overdueUpdated
          ? `, ${summary.overdueUpdated} marked overdue`
          : ""
      }.`,
    );
    router.refresh();
  }

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
    setBulkResult(null);

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

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
            Bulk Generate Rent Ledger
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            Select one or more Davors-managed landlords and run generation for
            the same billing month. Each landlord is processed separately with
            scoped overdue marking.
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px]">
            <label
              htmlFor="rent-ledger-bulk-billing-month"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Billing month
            </label>
            <input
              id="rent-ledger-bulk-billing-month"
              type="month"
              value={billingMonth}
              onChange={(event) => setBillingMonth(event.target.value)}
              className={inputClassName}
            />
          </div>
          <button
            type="button"
            disabled={bulkGenerating || selectedGenerateCount === 0}
            onClick={requestBulkGenerate}
            className={primaryButtonClassName}
          >
            {bulkGenerating
              ? "Generating…"
              : `Generate for selected (${selectedGenerateCount})`}
          </button>
        </div>

        {landlords.length === 0 ? (
          <p className="text-sm text-slate-500">
            No Davors-managed landlords available.
          </p>
        ) : (
          <ScrollableTable>
            <table className={scrollableTableClassName}>
              <thead className={scrollableTableHeadClassName}>
                <tr>
                  <th className={`${scrollableTableThClassName} w-10`}>
                    <input
                      type="checkbox"
                      checked={allGenerateSelected}
                      onChange={toggleSelectAllGenerateLandlords}
                      aria-label="Select all Davors-managed landlords"
                      className="h-4 w-4 rounded border-slate-300"
                    />
                  </th>
                  <th className={scrollableTableThClassName}>Landlord</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {landlords.map((landlord, index) => {
                  const selected = selectedGenerateIds.has(landlord.tenantId);
                  return (
                    <tr
                      key={landlord.tenantId}
                      className={`${getStripedRowClassName(index)} ${
                        selected ? "bg-slate-100" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() =>
                            toggleGenerateLandlord(landlord.tenantId)
                          }
                          aria-label={`Select ${landlord.name} for generation`}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                        {landlord.name}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollableTable>
        )}

        {bulkResult ? (
          <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-medium text-slate-800">
              Bulk run summary — {bulkResult.billingMonth}
            </p>
            <p className="text-sm text-slate-700">
              {bulkResult.landlordsProcessed} landlord
              {bulkResult.landlordsProcessed === 1 ? "" : "s"} processed:{" "}
              {bulkResult.created} created, {bulkResult.skipped} skipped,{" "}
              {bulkResult.errors} errors
              {bulkResult.overdueUpdated
                ? `, ${bulkResult.overdueUpdated} marked overdue`
                : ""}
              .
            </p>
            {bulkResult.landlords.length > 0 ? (
              <div>
                <button
                  type="button"
                  onClick={() => setShowBulkBreakdown((current) => !current)}
                  className="text-sm font-medium text-[#0f2744] hover:underline"
                >
                  {showBulkBreakdown
                    ? "Hide per-landlord breakdown"
                    : "Show per-landlord breakdown"}
                </button>
                {showBulkBreakdown ? (
                  <ScrollableTable>
                    <table className={`${scrollableTableClassName} mt-3`}>
                      <thead className={scrollableTableHeadClassName}>
                        <tr>
                          <th className={scrollableTableThClassName}>Landlord</th>
                          <th className={scrollableTableThClassName}>Created</th>
                          <th className={scrollableTableThClassName}>Skipped</th>
                          <th className={scrollableTableThClassName}>Errors</th>
                          <th className={scrollableTableThClassName}>Overdue</th>
                          <th className={scrollableTableThClassName}>Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {bulkResult.landlords.map((row, index) => (
                          <tr
                            key={row.tenantId}
                            className={getStripedRowClassName(index)}
                          >
                            <td className="px-4 py-3 text-sm text-slate-800">
                              {row.landlordName ?? row.tenantId}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {row.created}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {row.skipped}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {row.errors}
                            </td>
                            <td className="px-4 py-3 text-sm text-slate-700">
                              {row.overdueUpdated}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              {row.error ? (
                                <span className="text-red-700">{row.error}</span>
                              ) : row.ok ? (
                                <span className="text-emerald-700">OK</span>
                              ) : (
                                <span className="text-amber-800">
                                  Completed with lease errors
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollableTable>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {bulkConfirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-generate-confirm-title"
            className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3
              id="bulk-generate-confirm-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Confirm bulk rent ledger generation
            </h3>
            <p className="mt-3 text-sm text-slate-700">
              Generate rent ledger entries for{" "}
              <strong>{selectedGenerateCount}</strong> Davors-managed landlord
              {selectedGenerateCount === 1 ? "" : "s"} for billing month{" "}
              <strong>{billingMonth}</strong>?
            </p>
            {allGenerateSelected && landlords.length > 1 ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                You selected all {landlords.length} Davors-managed landlords.
                This runs generation for each landlord separately (not the
                platform cron), but still affects every managed portfolio for
                this month.
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={bulkGenerating}
                onClick={() => void handleBulkGenerateConfirmed()}
                className={primaryButtonClassName}
              >
                {bulkGenerating ? "Generating…" : "Run generation"}
              </button>
              <button
                type="button"
                disabled={bulkGenerating}
                onClick={() => setBulkConfirmOpen(false)}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
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
              <button
                type="button"
                disabled={generating || bulkGenerating}
                onClick={() => void handleGenerateNow()}
                className={secondaryButtonClassName}
                title="Generate for the landlord selected above only"
              >
                {generating ? "Generating…" : "Generate for this landlord"}
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
                  <th className={scrollableTableThClassName}>Type</th>
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
                      colSpan={10}
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
                        {row.chargeType === "one_time" ? (
                          <div>
                            <span className="font-medium">One-time</span>
                            {row.description ? (
                              <p className="mt-0.5 text-xs text-slate-500">
                                {row.description}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          "Rent"
                        )}
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
                          Math.max(
                            row.amountDueGhs -
                              row.amountPaidGhs -
                              (row.creditGhs ?? 0),
                            0,
                          ),
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
