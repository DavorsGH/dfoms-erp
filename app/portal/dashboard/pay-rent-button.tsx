"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { openPaystackInlineWithAccessCode } from "@/app/dashboard/pos/paystack-inline";

type PayRentButtonProps = {
  entryId: string;
  outstandingGhs: number;
  periodLabel: string;
};

type InitializeResponse = {
  ok?: boolean;
  error?: string;
  entry_id?: string;
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

/**
 * Portal Pay Rent — same Paystack Inline resumeTransaction pattern as POS MoMo.
 */
export default function PayRentButton({
  entryId,
  outstandingGhs,
  periodLabel,
}: PayRentButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handlePay() {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      const initResponse = await fetch("/api/portal/rent/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entry_id: entryId }),
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

      await openPaystackInlineWithAccessCode(accessCode, {
        onSuccess: async (transaction) => {
          try {
            const confirmResponse = await fetch(
              "/api/portal/rent/paystack/confirm",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  entry_id: entryId,
                  reference: transaction.reference ?? initPayload.reference,
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

            setSuccess(
              `Payment received for ${periodLabel}. Thank you.`,
            );
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
      <button
        type="button"
        onClick={() => void handlePay()}
        disabled={loading || outstandingGhs <= 0}
        className="inline-flex items-center justify-center rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#163559] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading
          ? "Opening Paystack…"
          : `Pay ${formatMoney(outstandingGhs)} (MoMo or card)`}
      </button>
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
