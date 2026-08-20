"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PlatformHubtelBalanceEstimate } from "@/utils/platform-sms-usage-types";

type HubtelBalanceEstimateCardProps = {
  estimate: PlatformHubtelBalanceEstimate;
};

function formatMoney(value: number): string {
  return value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatLoggedAt(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function HubtelBalanceEstimateCard({
  estimate,
}: HubtelBalanceEstimateCardProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valueLabel = estimate.available && estimate.estimatedBalanceGhs !== null
    ? `GHS ${formatMoney(estimate.estimatedBalanceGhs)} estimated`
    : "No estimate yet";

  const hintParts: string[] = [];
  if (estimate.available && estimate.lastLoggedAmountGhs !== null && estimate.lastLoggedAt) {
    hintParts.push(
      `Last logged GHS ${formatMoney(estimate.lastLoggedAmountGhs)} on ${formatLoggedAt(estimate.lastLoggedAt)}`,
    );
  }
  if (estimate.available) {
    hintParts.push(
      `${estimate.totalSendsSinceLog.toLocaleString("en-GH")} SMS since log (${estimate.transactionalSendsSinceLog.toLocaleString("en-GH")} transactional + ${estimate.otpSendsSinceLog.toLocaleString("en-GH")} OTP) at GHS ${estimate.smsUnitCostGhs} each`,
    );
  } else if (estimate.note) {
    hintParts.push(estimate.note);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      setError("Enter a valid non-negative balance amount.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/admin/hubtel-balance-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_ghs: parsedAmount,
          note: note.trim() || null,
        }),
      });

      const body = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(body?.error ?? "Unable to log balance.");
        return;
      }

      setModalOpen(false);
      setAmount("");
      setNote("");
      router.refresh();
    } catch {
      setError("Unable to log balance.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Estimated Hubtel Balance
            </p>
            <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
              {valueLabel}
            </p>
            {hintParts.length > 0 ? (
              <p className="mt-1 text-xs text-slate-500">{hintParts.join(" · ")}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setModalOpen(true);
            }}
            className="shrink-0 rounded-md bg-[#0f2744] px-3 py-2 text-xs font-medium text-white hover:bg-[#1a3a5c]"
          >
            Log Hubtel Balance
          </button>
        </div>
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="log-hubtel-balance-title"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="log-hubtel-balance-title"
                  className="text-lg font-semibold text-[#0f2744]"
                >
                  Log Hubtel Balance
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Enter the balance shown in Hubtel&apos;s dashboard under
                  Developers → Programmable API Keys → SMS API Keys.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={submitting}
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="hubtel_balance_amount"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Balance (GHS)
                </label>
                <input
                  id="hubtel_balance_amount"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="73.61"
                />
              </div>

              <div>
                <label
                  htmlFor="hubtel_balance_note"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Note (optional)
                </label>
                <textarea
                  id="hubtel_balance_note"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  placeholder="e.g. After topping up SMS API wallet"
                />
              </div>

              {error ? (
                <p className="text-sm text-red-600">{error}</p>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={submitting}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-60"
                >
                  {submitting ? "Saving…" : "Save reading"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
