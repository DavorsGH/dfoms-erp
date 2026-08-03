"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  extractPaystackInlineReference,
  openPaystackInlineWithAccessCode,
} from "@/app/dashboard/pos/paystack-inline";
import { canInitiatePortalRentPayment } from "@/utils/lease-signature";

type PayRentButtonProps = {
  entryIds: string[];
  outstandingGhs: number;
  periodLabel: string;
  signatureStatus?: string | null;
  paymentBlockedMessage?: string | null;
};

type InitializeResponse = {
  ok?: boolean;
  error?: string;
  entry_id?: string;
  entry_ids?: string[];
  reference?: string;
  access_code?: string;
  amount_ghs?: number;
};

type ConfirmResponse = {
  ok?: boolean;
  error?: string;
  already_fulfilled?: boolean;
  status?: string;
};

function formatMoney(value: number): string {
  return `GHS ${value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeEntryIds(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

/**
 * Portal Pay — Paystack Inline for rent + outstanding one-time charges
 * in a single bundled transaction.
 */
export default function PayRentButton({
  entryIds,
  outstandingGhs,
  periodLabel,
  signatureStatus = null,
  paymentBlockedMessage = null,
}: PayRentButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const paymentAllowed = canInitiatePortalRentPayment(signatureStatus);
  const blockedMessage =
    paymentBlockedMessage ??
    (!paymentAllowed
      ? "Rent payment is unavailable until the lease is acknowledged."
      : null);

  async function handlePay() {
    if (!paymentAllowed) {
      setError(blockedMessage);
      return;
    }

    const requestedEntryIds = normalizeEntryIds(entryIds);
    if (requestedEntryIds.length === 0 || outstandingGhs <= 0) {
      setError("Nothing outstanding to pay.");
      return;
    }

    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const initResponse = await fetch("/api/portal/rent/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entry_id: requestedEntryIds[0],
          entry_ids: requestedEntryIds,
        }),
      });
      const initPayload = (await initResponse.json()) as InitializeResponse;
      if (!initResponse.ok || !initPayload.ok) {
        setError(initPayload.error ?? "Could not start rent payment.");
        setLoading(false);
        return;
      }

      const accessCode = initPayload.access_code?.trim() ?? "";
      if (!accessCode) {
        setError("Paystack did not return an access code.");
        setLoading(false);
        return;
      }

      const initReference = initPayload.reference?.trim() ?? "";
      const confirmEntryIds = normalizeEntryIds([
        ...(initPayload.entry_ids ?? []),
        initPayload.entry_id,
        ...requestedEntryIds,
      ]);

      if (!initReference) {
        setError("Paystack did not return a payment reference.");
        setLoading(false);
        return;
      }

      if (confirmEntryIds.length === 0) {
        setError(
          "Could not determine which charges to pay. Refresh and try again.",
        );
        setLoading(false);
        return;
      }

      await openPaystackInlineWithAccessCode(accessCode, {
        onSuccess: async (transaction) => {
          try {
            const paymentReference = extractPaystackInlineReference(
              transaction,
              initReference,
            );

            if (!paymentReference) {
              setError(
                "Payment completed but no reference was returned. Refresh shortly — webhook may still apply it.",
              );
              setLoading(false);
              return;
            }

            const confirmResponse = await fetch(
              "/api/portal/rent/paystack/confirm",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  entry_id: confirmEntryIds[0],
                  entry_ids: confirmEntryIds,
                  reference: paymentReference,
                }),
              },
            );
            const confirmPayload =
              (await confirmResponse.json()) as ConfirmResponse;

            if (!confirmResponse.ok || !confirmPayload.ok) {
              setError(
                confirmPayload.error ??
                  "Payment succeeded but confirmation failed. Refresh shortly — webhook may still apply it.",
              );
              setLoading(false);
              return;
            }

            setSuccess(`Payment received for ${periodLabel}. Thank you.`);
            setLoading(false);
            router.refresh();
          } catch (confirmError) {
            setError(
              confirmError instanceof Error
                ? confirmError.message
                : "Payment confirmation failed.",
            );
            setLoading(false);
          }
        },
        onCancel: () => {
          setError("Payment cancelled.");
          setLoading(false);
        },
        onError: (paystackError) => {
          setError(
            paystackError.message?.trim() || "Paystack checkout failed.",
          );
          setLoading(false);
        },
      });
    } catch (payError) {
      setError(
        payError instanceof Error ? payError.message : "Payment failed.",
      );
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 space-y-2">
      {paymentAllowed ? (
        <button
          type="button"
          onClick={() => void handlePay()}
          disabled={loading || outstandingGhs <= 0 || entryIds.length === 0}
          className="inline-flex cursor-pointer items-center justify-center rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "Opening Paystack…"
            : `Pay ${formatMoney(outstandingGhs)} (MoMo or card)`}
        </button>
      ) : (
        <p className="text-sm text-amber-800" role="status">
          {blockedMessage}
        </p>
      )}
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-700" role="status">
          {success}
        </p>
      ) : null}
    </div>
  );
}
