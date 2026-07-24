"use client";

import { useEffect, useState } from "react";
import { inputClassName } from "../employees/employee-record-utils";
import { formatGHS } from "../finance/income-register-utils";
import {
  isValidEmail,
  normalizeGhanaPhone,
  roundGhs,
} from "@/utils/product-sale-paystack";
import type { PosCartLine } from "./pos-utils";

type CartModeProps = {
  mode: "cart";
  cartLines: PosCartLine[];
  saleDate: string;
  clientId: string | null;
  customerName: string | null;
  notes: string | null;
  dueDate: string;
  paymentMethod: string;
  defaultAmountGhs: number;
  defaultEmail: string;
  defaultPhone: string;
  onClose: () => void;
  /** Called after a payment link is created successfully (clear cart, etc.). */
  onLinkSent?: () => void;
};

type InvoiceModeProps = {
  mode?: "invoice";
  invoiceNo: string;
  paymentMethod: string;
  defaultAmountGhs: number;
  defaultEmail: string;
  defaultPhone: string;
  onClose: () => void;
  onLinkSent?: () => void;
};

export type RequestPaymentModalProps = CartModeProps | InvoiceModeProps;

type InitializeResponse = {
  ok?: boolean;
  error?: string;
  payment_request_id?: string;
  reference?: string;
  authorization_url?: string;
  amount_ghs?: number;
  email_sent?: boolean;
  sms_sent?: boolean;
  email_error?: string | null;
  sms_error?: string | null;
  charge_first?: boolean;
};

function isCartMode(props: RequestPaymentModalProps): props is CartModeProps {
  return props.mode === "cart";
}

export default function RequestPaymentModal(props: RequestPaymentModalProps) {
  const {
    paymentMethod,
    defaultAmountGhs,
    defaultEmail,
    defaultPhone,
    onClose,
    onLinkSent,
  } = props;

  const invoiceNo = isCartMode(props) ? null : props.invoiceNo;
  const cartLockedAmount = isCartMode(props);

  const [amount, setAmount] = useState(String(roundGhs(defaultAmountGhs)));
  const [email, setEmail] = useState(defaultEmail);
  const [phone, setPhone] = useState(defaultPhone);
  const [sendEmail, setSendEmail] = useState(Boolean(defaultEmail.trim()));
  const [sendSms, setSendSms] = useState(Boolean(defaultPhone.trim()));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InitializeResponse | null>(null);

  useEffect(() => {
    setAmount(String(roundGhs(defaultAmountGhs)));
    setEmail(defaultEmail);
    setPhone(defaultPhone);
    setSendEmail(Boolean(defaultEmail.trim()));
    setSendSms(Boolean(defaultPhone.trim()));
  }, [defaultAmountGhs, defaultEmail, defaultPhone]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const amountGhs = roundGhs(Number.parseFloat(amount));
    if (!Number.isFinite(amountGhs) || amountGhs <= 0) {
      setError("Enter a payment amount greater than zero.");
      setLoading(false);
      return;
    }

    if (!cartLockedAmount && amountGhs > defaultAmountGhs + 0.001) {
      setError(
        `Amount cannot exceed outstanding balance (${formatGHS(defaultAmountGhs)}).`,
      );
      setLoading(false);
      return;
    }

    if (!sendEmail && !sendSms) {
      setError("Select at least one delivery channel (email or SMS).");
      setLoading(false);
      return;
    }

    if (sendEmail && !isValidEmail(email)) {
      setError("Enter a valid email address for email delivery.");
      setLoading(false);
      return;
    }

    if (sendSms && !normalizeGhanaPhone(phone)) {
      setError("Enter a valid Ghana phone number (e.g. 024… or +233…).");
      setLoading(false);
      return;
    }

    try {
      const body = isCartMode(props)
        ? {
            cart_lines: props.cartLines,
            sale_date: props.saleDate,
            client_id: props.clientId,
            customer_name: props.customerName,
            notes: props.notes,
            due_date: props.dueDate,
            amount_ghs: amountGhs,
            delivery_email: email.trim() || null,
            delivery_phone: phone.trim() || null,
            send_email: sendEmail,
            send_sms: sendSms,
            payment_method: paymentMethod,
          }
        : {
            invoice_no: invoiceNo,
            amount_ghs: amountGhs,
            delivery_email: email.trim() || null,
            delivery_phone: phone.trim() || null,
            send_email: sendEmail,
            send_sms: sendSms,
            payment_method: paymentMethod,
          };

      const response = await fetch("/api/sales/paystack/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as
        | InitializeResponse
        | null;

      if (!response.ok || !payload?.authorization_url) {
        setError(payload?.error ?? "Failed to create payment link.");
        setLoading(false);
        return;
      }

      setResult(payload);
      onLinkSent?.();
      setLoading(false);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create payment link.",
      );
      setLoading(false);
    }
  }

  const subtitle = isCartMode(props)
    ? "Send a Paystack link by email and/or SMS. No sale or stock change until the customer pays."
    : `Invoice ${invoiceNo} — send a Paystack link by email and/or SMS.`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="request-payment-title"
        className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="request-payment-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Request Payment
            </h2>
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-500 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {result?.authorization_url ? (
          <div className="mt-4 space-y-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-950">
            <p className="font-medium">Payment link created</p>
            {result.charge_first ? (
              <p>
                Sale and stock will update only after the customer completes
                payment.
              </p>
            ) : null}
            <p className="break-all">
              <a
                href={result.authorization_url}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {result.authorization_url}
              </a>
            </p>
            <p>
              Email:{" "}
              {result.email_sent
                ? "sent"
                : result.email_error
                  ? `failed (${result.email_error})`
                  : "not requested"}
            </p>
            <p>
              SMS:{" "}
              {result.sms_sent
                ? "sent"
                : result.sms_error
                  ? `failed (${result.sms_error})`
                  : "not requested"}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    result.authorization_url ?? "",
                  )
                }
                className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-50"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1a3a5c]"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Amount (GHS)
              </label>
              <input
                type="number"
                min={0.01}
                step="0.01"
                required
                value={amount}
                readOnly={cartLockedAmount}
                onChange={(event) => setAmount(event.target.value)}
                className={inputClassName}
              />
              <p className="mt-1 text-xs text-slate-500">
                {cartLockedAmount
                  ? `Cart total: ${formatGHS(defaultAmountGhs)}`
                  : `Outstanding: ${formatGHS(defaultAmountGhs)}`}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputClassName}
                placeholder="customer@example.com"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Phone
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className={inputClassName}
                placeholder="+233…"
              />
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-slate-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  onChange={(event) => setSendEmail(event.target.checked)}
                />
                Send email
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={sendSms}
                  onChange={(event) => setSendSms(event.target.checked)}
                />
                Send SMS
              </label>
            </div>

            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50"
              >
                {loading ? "Creating link…" : "Send payment link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
