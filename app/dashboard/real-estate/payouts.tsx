"use client";

import { useEffect, useState } from "react";
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
  formatPayoutDate,
  formatPayoutMoney,
  formatPayoutPeriod,
  formatRemittanceStatus,
  type PayoutListRow,
} from "./payouts-utils";

type PayoutsProps = {
  landlords: LandlordListRow[];
  selectedLandlordId: string | null;
  landlordType: LandlordType | null;
  managementFeePercent: number | null;
  initialRows: PayoutListRow[];
  escrowBalanceGhs: number;
  landlordsError: string | null;
  payoutsError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function Payouts({
  landlords,
  selectedLandlordId,
  landlordType,
  managementFeePercent,
  initialRows,
  escrowBalanceGhs,
  landlordsError,
  payoutsError,
}: PayoutsProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(
    landlordsError ?? payoutsError,
  );
  const [success, setSuccess] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [markingPayoutId, setMarkingPayoutId] = useState<string | null>(null);
  const [remittanceReference, setRemittanceReference] = useState("");

  useEffect(() => {
    setRows(initialRows);
  }, [initialRows]);

  useEffect(() => {
    setError(landlordsError ?? payoutsError);
  }, [landlordsError, payoutsError]);

  const selectedLandlord = landlords.find(
    (row) => row.tenantId === selectedLandlordId,
  );
  const isPlatformOnly = landlordType === "platform_only";
  const isDavorsManaged = landlordType === "davors_managed";

  function handleLandlordChange(tenantId: string) {
    setShowGenerate(false);
    setMarkingPayoutId(null);
    setSuccess(null);
    if (!tenantId) {
      router.push("/dashboard/real-estate/payouts");
      return;
    }
    router.push(
      `/dashboard/real-estate/payouts?landlord=${encodeURIComponent(tenantId)}`,
    );
  }

  async function handleGenerate(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/payouts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        period_start: periodStart,
        period_end: periodEnd,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(
        payload?.error ??
          (isPlatformOnly
            ? "Unable to generate statement."
            : "Unable to generate payout."),
      );
      setLoading(false);
      return;
    }

    setShowGenerate(false);
    setPeriodStart("");
    setPeriodEnd("");
    setLoading(false);
    setSuccess(
      isPlatformOnly ? "Statement generated." : "Payout generated.",
    );
    router.refresh();
  }

  async function handleMarkRemitted(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedLandlordId || !markingPayoutId) {
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/payouts/mark-remitted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: selectedLandlordId,
        payout_id: markingPayoutId,
        remittance_reference: remittanceReference,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to mark payout as remitted.");
      setLoading(false);
      return;
    }

    setMarkingPayoutId(null);
    setRemittanceReference("");
    setLoading(false);
    setSuccess("Payout marked as remitted.");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="max-w-md">
        <label
          htmlFor="payouts-landlord-picker"
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Landlord
        </label>
        <select
          id="payouts-landlord-picker"
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
            Select a landlord to view statements or payouts.
          </p>
        </div>
      ) : !landlordType ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          Set this landlord&apos;s type on the Landlords tab before generating
          statements or payouts.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-600">
                {isPlatformOnly ? "Statements" : "Payouts"} for{" "}
                <span className="font-medium text-[#0f2744]">
                  {selectedLandlord?.name ?? "selected landlord"}
                </span>
              </p>
              {isDavorsManaged ? (
                <p className="mt-1 text-sm text-slate-600">
                  Escrow balance:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatPayoutMoney(escrowBalanceGhs)}
                  </span>
                  {managementFeePercent != null ? (
                    <span className="text-slate-500">
                      {" "}
                      · Management fee rate: {managementFeePercent}%
                    </span>
                  ) : (
                    <span className="text-amber-700">
                      {" "}
                      · Management fee percent is not set
                    </span>
                  )}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowGenerate((current) => !current);
                setMarkingPayoutId(null);
              }}
              className={primaryButtonClassName}
            >
              {showGenerate
                ? "Cancel"
                : isPlatformOnly
                  ? "Generate Statement"
                  : "Generate Payout"}
            </button>
          </div>

          {showGenerate ? (
            <form
              onSubmit={handleGenerate}
              className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
                {isPlatformOnly ? "Generate Statement" : "Generate Payout"}
              </h3>
              <p className="text-sm text-slate-600">
                Sums rent ledger amounts paid with a payment date in the
                selected period
                {isDavorsManaged
                  ? ", then applies this landlord's current management fee percent."
                  : "."}
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Period Start
                  </label>
                  <input
                    required
                    type="date"
                    value={periodStart}
                    onChange={(event) => setPeriodStart(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Period End
                  </label>
                  <input
                    required
                    type="date"
                    value={periodEnd}
                    onChange={(event) => setPeriodEnd(event.target.value)}
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
                  {loading
                    ? "Generating…"
                    : isPlatformOnly
                      ? "Create Statement"
                      : "Create Payout"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowGenerate(false)}
                  className={secondaryButtonClassName}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {markingPayoutId ? (
            <form
              onSubmit={handleMarkRemitted}
              className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
            >
              <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
                Mark as Remitted
              </h3>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Remittance Reference
                </label>
                <input
                  required
                  type="text"
                  value={remittanceReference}
                  onChange={(event) =>
                    setRemittanceReference(event.target.value)
                  }
                  placeholder="e.g. bank transfer reference"
                  className={inputClassName}
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={primaryButtonClassName}
                >
                  {loading ? "Saving…" : "Confirm Remittance"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMarkingPayoutId(null);
                    setRemittanceReference("");
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
                  <th className={scrollableTableThClassName}>Period</th>
                  <th className={scrollableTableThClassName}>Gross Amount</th>
                  {isDavorsManaged ? (
                    <>
                      <th className={scrollableTableThClassName}>
                        Management Fee
                      </th>
                      <th className={scrollableTableThClassName}>Net Amount</th>
                      <th className={scrollableTableThClassName}>
                        Remittance Status
                      </th>
                      <th className={scrollableTableThClassName}>
                        Remittance Date
                      </th>
                      <th className={scrollableTableThClassName}>Actions</th>
                    </>
                  ) : (
                    <th className={scrollableTableThClassName}>Created Date</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={isDavorsManaged ? 7 : 3}
                      className="px-4 py-8 text-center text-sm text-slate-500"
                    >
                      {isPlatformOnly
                        ? "No statements yet for this landlord."
                        : "No payouts yet for this landlord."}
                    </td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr
                      key={row.payoutId}
                      className={getStripedRowClassName(index)}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                        {formatPayoutPeriod(row.periodStart, row.periodEnd)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-700">
                        {formatPayoutMoney(row.grossAmountGhs)}
                      </td>
                      {isDavorsManaged ? (
                        <>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {formatPayoutMoney(row.managementFeeGhs)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {formatPayoutMoney(row.netAmountGhs)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {formatRemittanceStatus(row.remittanceStatus)}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700">
                            {formatPayoutDate(row.remittanceDate)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {row.remittanceStatus === "pending" ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setShowGenerate(false);
                                  setMarkingPayoutId(row.payoutId);
                                  setRemittanceReference("");
                                }}
                                className="text-[#0f2744] hover:underline"
                              >
                                Mark as Remitted
                              </button>
                            ) : row.remittanceReference ? (
                              <span className="text-slate-500">
                                Ref: {row.remittanceReference}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
                      ) : (
                        <td className="px-4 py-3 text-sm text-slate-700">
                          {formatPayoutDate(row.createdAt)}
                        </td>
                      )}
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
