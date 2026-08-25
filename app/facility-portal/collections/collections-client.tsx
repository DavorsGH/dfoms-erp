"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRentMoney } from "@/app/dashboard/real-estate/rent-ledger-utils";
import type {
  FacilityCollectionListRow,
  FacilityOutstandingLedgerRow,
} from "@/utils/facility-portal-types";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
  portalTabBarClassName,
  portalTabButtonClassName,
} from "../portal-ui";

type FacilityCollectionsClientProps = {
  outstanding: FacilityOutstandingLedgerRow[];
  history: FacilityCollectionListRow[];
  canCollectRent: boolean;
  canCollectCharges: boolean;
};

type TabId = "outstanding" | "history";

const PAYMENT_METHOD_OPTIONS = [
  { value: "cash", label: "Cash" },
  { value: "momo", label: "Mobile Money" },
  { value: "bank_transfer", label: "Bank Transfer" },
] as const;

export default function FacilityCollectionsClient({
  outstanding,
  history,
  canCollectRent,
  canCollectCharges,
}: FacilityCollectionsClientProps) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>("outstanding");
  const [selectedEntryId, setSelectedEntryId] = useState(
    outstanding.find((r) => !r.hasPendingCollection)?.entryId ?? "",
  );
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const selectedRow = outstanding.find((r) => r.entryId === selectedEntryId);

  async function handleRecord(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedEntryId) {
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/facility-portal/collections/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rent_ledger_entry_id: selectedEntryId,
        amount_ghs: amount,
        payment_method: paymentMethod,
        notes: notes.trim() === "" ? null : notes,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to record collection.");
      setLoading(false);
      return;
    }

    setAmount("");
    setNotes("");
    setSuccess(
      "Collection recorded. Pending landlord confirmation — rent ledger not updated yet.",
    );
    setTab("history");
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className={portalTabBarClassName} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "outstanding"}
          className={portalTabButtonClassName(tab === "outstanding")}
          onClick={() => setTab("outstanding")}
        >
          Outstanding
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "history"}
          className={portalTabButtonClassName(tab === "history")}
          onClick={() => setTab("history")}
        >
          My collections
        </button>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      {tab === "outstanding" ? (
        <>
          <section className={portalCompactSectionClassName}>
            <p className="text-sm text-slate-600">
              Record cash, mobile money, or bank transfer collections. Amounts
              stay pending until your landlord confirms — the rent ledger is not
              updated until then.
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {canCollectRent && canCollectCharges
                ? "Showing rent and one-time charges."
                : canCollectRent
                  ? "Showing rent only."
                  : "Showing one-time charges only."}
            </p>
          </section>

          {outstanding.length === 0 ? (
            <section className={portalCompactSectionClassName}>
              <p className="text-sm text-slate-600">
                No outstanding ledger entries on your assigned properties.
              </p>
            </section>
          ) : (
            <>
              <ul className="space-y-2">
                {outstanding.map((row) => (
                  <li
                    key={row.entryId}
                    className={`${portalCompactSectionClassName} cursor-pointer ${
                      selectedEntryId === row.entryId
                        ? "ring-2 ring-[#0f2744]/20"
                        : ""
                    }`}
                    onClick={() => setSelectedEntryId(row.entryId)}
                  >
                    <p className="text-sm font-medium text-[#0f2744]">
                      {row.lesseeName} · {row.unitLabel}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {row.chargeType === "one_time" ? "One-time" : "Rent"}
                      {row.description ? ` · ${row.description}` : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Outstanding {formatRentMoney(row.outstandingGhs)} ·{" "}
                      {row.statusLabel}
                      {row.hasPendingCollection ? " · pending collection" : ""}
                    </p>
                  </li>
                ))}
              </ul>

              {selectedRow && !selectedRow.hasPendingCollection ? (
                <section className={portalCompactSectionClassName}>
                  <form onSubmit={handleRecord} className="space-y-3">
                    <p className="text-sm text-slate-700">
                      Recording for {selectedRow.lesseeName} — outstanding{" "}
                      {formatRentMoney(selectedRow.outstandingGhs)}
                    </p>
                    <div>
                      <label className={portalLabelClassName} htmlFor="fm-col-amt">
                        Amount (GHS)
                      </label>
                      <input
                        id="fm-col-amt"
                        type="number"
                        min="0.01"
                        step="0.01"
                        max={selectedRow.outstandingGhs}
                        className={portalInputClassName}
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className={portalLabelClassName} htmlFor="fm-col-method">
                        Payment method
                      </label>
                      <select
                        id="fm-col-method"
                        className={portalInputClassName}
                        value={paymentMethod}
                        onChange={(event) => setPaymentMethod(event.target.value)}
                        required
                      >
                        {PAYMENT_METHOD_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={portalLabelClassName} htmlFor="fm-col-notes">
                        Notes (optional)
                      </label>
                      <textarea
                        id="fm-col-notes"
                        className={`${portalInputClassName} min-h-[72px]`}
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                      />
                    </div>
                    <button
                      type="submit"
                      className={portalPrimaryButtonClassName}
                      disabled={loading}
                    >
                      {loading ? "Submitting…" : "Record collection"}
                    </button>
                  </form>
                </section>
              ) : selectedRow?.hasPendingCollection ? (
                <section className={portalCompactSectionClassName}>
                  <p className="text-sm text-amber-800">
                    This entry already has a collection pending landlord
                    confirmation.
                  </p>
                </section>
              ) : null}
            </>
          )}
        </>
      ) : history.length === 0 ? (
        <section className={portalCompactSectionClassName}>
          <p className="text-sm text-slate-600">No collections recorded yet.</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {history.map((row) => (
            <li key={row.collectionId} className={portalCompactSectionClassName}>
              <p className="text-sm font-medium text-[#0f2744]">
                {formatRentMoney(row.amountGhs)} · {row.paymentMethodLabel}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {row.lesseeName} · {row.unitLabel} · {row.collectedAtLabel}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Status: {row.statusLabel}
                {row.ledgerDescription ? ` · ${row.ledgerDescription}` : ""}
              </p>
              {row.notes ? (
                <p className="mt-1 text-sm text-slate-700">{row.notes}</p>
              ) : null}
              {row.rejectionReason ? (
                <p className="mt-1 text-sm text-red-700">
                  Rejection: {row.rejectionReason}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
