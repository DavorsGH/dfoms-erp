"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatInvoiceMoney, todayIsoDate } from "@/utils/client-invoices-types";
import type { RecordClientInvoicePaymentBody } from "@/utils/client-receipts-types";

type RecordPaymentDialogProps = {
  invoiceId: string;
  invoiceNumber: string;
  totalDue: number;
  amountReceived: number;
  paymentMethods: string[];
  onClose: () => void;
  onSuccess?: () => void;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function RecordPaymentDialog({
  invoiceId,
  invoiceNumber,
  totalDue,
  amountReceived,
  paymentMethods,
  onClose,
  onSuccess,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const outstanding = Math.max(totalDue - amountReceived, 0);

  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding : 0);
  const [paymentMethod, setPaymentMethod] = useState(paymentMethods[0] ?? "");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const body: RecordClientInvoicePaymentBody = {
      payment_date: paymentDate,
      amount,
      payment_method: paymentMethod.trim() || null,
      notes: notes.trim() || null,
    };

    try {
      const response = await fetch(`/api/client-invoices/${invoiceId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; receipt?: { id: string } }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to record payment.");
        setSubmitting(false);
        return;
      }

      onSuccess?.();
      router.refresh();
      onClose();

      if (payload?.receipt?.id) {
        router.push(`/dashboard/finance/client-receipts/${payload.receipt.id}`);
      }
    } catch {
      setError("Unable to record payment. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-payment-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3 id="record-payment-title" className="text-lg font-semibold text-[#0f2744]">
          Record Payment
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Invoice {invoiceNumber} — outstanding{" "}
          <span className="font-medium">{formatInvoiceMoney(outstanding)}</span>
        </p>

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-4">
          <div>
            <label htmlFor="payment_date" className="mb-1 block text-sm font-medium text-slate-700">
              Payment date
            </label>
            <input
              id="payment_date"
              type="date"
              required
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="payment_amount" className="mb-1 block text-sm font-medium text-slate-700">
              Amount (GHS)
            </label>
            <input
              id="payment_amount"
              type="number"
              required
              min={0.01}
              step={0.01}
              max={outstanding}
              value={amount}
              onChange={(event) => setAmount(Number(event.target.value))}
              className={inputClassName}
            />
          </div>

          <div>
            <label htmlFor="payment_method" className="mb-1 block text-sm font-medium text-slate-700">
              Payment method
            </label>
            {paymentMethods.length > 0 ? (
              <select
                id="payment_method"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                className={inputClassName}
              >
                {paymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="payment_method"
                type="text"
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                placeholder="e.g. Bank transfer, MoMo, Cash"
                className={inputClassName}
              />
            )}
          </div>

          <div>
            <label htmlFor="payment_notes" className="mb-1 block text-sm font-medium text-slate-700">
              Notes
            </label>
            <textarea
              id="payment_notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || outstanding <= 0}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Recording…" : "Record payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
