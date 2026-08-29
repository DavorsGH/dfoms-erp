"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  computeClientInvoiceCashOutstanding,
  computeClientInvoiceNetCashDue,
} from "@/utils/client-invoice-payment-utils";
import { formatInvoiceMoney, todayIsoDate, toNumber } from "@/utils/client-invoices-types";
import type { RecordClientInvoicePaymentBody } from "@/utils/client-receipts-types";

type RecordPaymentDialogProps = {
  invoiceId: string;
  invoiceNumber: string;
  totalDue: number;
  whtRate?: number;
  whtAmount?: number;
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
  whtRate = 0,
  whtAmount = 0,
  amountReceived,
  paymentMethods,
  onClose,
  onSuccess,
}: RecordPaymentDialogProps) {
  const router = useRouter();
  const hasWht = toNumber(whtAmount) > 0;
  const netCashDue = computeClientInvoiceNetCashDue(totalDue, whtAmount);
  const cashOutstanding = computeClientInvoiceCashOutstanding(
    totalDue,
    whtAmount,
    amountReceived,
  );

  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [amount, setAmount] = useState(cashOutstanding > 0 ? cashOutstanding : 0);
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
          Invoice {invoiceNumber} — cash outstanding{" "}
          <span className="font-medium">{formatInvoiceMoney(cashOutstanding)}</span>
        </p>

        {hasWht ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm">
            <dl className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-700">Total due</dt>
                <dd className="font-medium text-slate-900">{formatInvoiceMoney(totalDue)}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-slate-700">
                  Less WHT ({toNumber(whtRate)}%)
                </dt>
                <dd className="font-medium text-slate-900">
                  {formatInvoiceMoney(whtAmount)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-1.5">
                <dt className="font-medium text-[#0f2744]">Net cash expected</dt>
                <dd className="font-semibold text-[#0f2744]">
                  {formatInvoiceMoney(netCashDue)}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-slate-500">
              WHT is set on the invoice — enter cash received only. Do not include
              withheld tax in the payment amount.
            </p>
          </div>
        ) : null}

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
              max={cashOutstanding}
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
              disabled={submitting || cashOutstanding <= 0}
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
