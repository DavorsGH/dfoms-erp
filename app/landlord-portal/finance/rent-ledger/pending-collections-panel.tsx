"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRentMoney } from "@/app/dashboard/real-estate/rent-ledger-utils";
import type { LandlordPendingCollectionRow } from "@/utils/landlord-portal-collections";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
  portalSuccessBannerClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";

type LandlordPendingCollectionsPanelProps = {
  rows: LandlordPendingCollectionRow[];
  canAct: boolean;
};

export default function LandlordPendingCollectionsPanel({
  rows,
  canAct,
}: LandlordPendingCollectionsPanelProps) {
  const router = useRouter();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (rows.length === 0) {
    return null;
  }

  async function handleConfirm(collectionId: string) {
    setLoadingId(collectionId);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/collections/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection_id: collectionId }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to confirm collection.");
      setLoadingId(null);
      return;
    }

    setSuccess("Collection confirmed. Rent ledger updated.");
    setLoadingId(null);
    router.refresh();
  }

  async function handleReject(collectionId: string) {
    setLoadingId(collectionId);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/collections/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collection_id: collectionId,
        rejection_reason: rejectReason.trim() === "" ? null : rejectReason,
      }),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to reject collection.");
      setLoadingId(null);
      return;
    }

    setRejectId(null);
    setRejectReason("");
    setSuccess("Collection rejected. Rent ledger unchanged.");
    setLoadingId(null);
    router.refresh();
  }

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>Pending FM collections</h2>
      <p className="mt-1 text-sm text-slate-600">
        Facility managers recorded these collections. Confirm to apply payment to
        the rent ledger, or reject to leave the ledger unchanged.
      </p>

      {error ? <div className={`mt-3 ${portalErrorBannerClassName}`}>{error}</div> : null}
      {success ? (
        <div className={`mt-3 ${portalSuccessBannerClassName}`}>{success}</div>
      ) : null}

      <ul className="mt-4 space-y-3">
        {rows.map((row) => (
          <li key={row.collectionId} className={`${portalSectionClassName} p-4`}>
            <p className="text-sm font-medium text-[#0f2744]">
              {formatRentMoney(row.amountGhs)} · {row.paymentMethodLabel}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {row.lesseeName} · {row.unitLabel} · collected{" "}
              {row.collectedAtLabel}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Reported by {row.facilityManagerName} ·{" "}
              {row.chargeType === "one_time" ? "One-time charge" : "Rent"}
              {row.ledgerDescription ? ` · ${row.ledgerDescription}` : ""}
            </p>
            {row.notes ? (
              <p className="mt-1 text-sm text-slate-700">{row.notes}</p>
            ) : null}

            {canAct ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={portalPrimaryButtonClassName}
                  disabled={loadingId === row.collectionId}
                  onClick={() => void handleConfirm(row.collectionId)}
                >
                  {loadingId === row.collectionId ? "Confirming…" : "Confirm"}
                </button>
                <button
                  type="button"
                  className={portalSecondaryButtonClassName}
                  disabled={loadingId === row.collectionId}
                  onClick={() =>
                    setRejectId((current) =>
                      current === row.collectionId ? null : row.collectionId,
                    )
                  }
                >
                  Reject
                </button>
              </div>
            ) : (
              <p className="mt-2 text-xs text-slate-500">View only</p>
            )}

            {canAct && rejectId === row.collectionId ? (
              <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                <label className={portalLabelClassName} htmlFor={`reject-${row.collectionId}`}>
                  Rejection reason (optional)
                </label>
                <textarea
                  id={`reject-${row.collectionId}`}
                  className={`${portalInputClassName} min-h-[72px]`}
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                />
                <button
                  type="button"
                  className={portalPrimaryButtonClassName}
                  disabled={loadingId === row.collectionId}
                  onClick={() => void handleReject(row.collectionId)}
                >
                  {loadingId === row.collectionId
                    ? "Rejecting…"
                    : "Confirm rejection"}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
