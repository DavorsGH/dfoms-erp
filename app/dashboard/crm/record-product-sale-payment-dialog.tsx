"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";
import {
  isManualSalePaymentMethod,
  MANUAL_SALE_PAYMENT_METHODS,
  todayIsoDate,
  type RecordProductSalePaymentBody,
} from "@/utils/product-sale-payments-types";
import {
  isPaystackCollectMethod,
  type ManualSaleCollectionMode,
} from "@/utils/manual-sale-paystack";
import ManualSaleCollectionFields from "./manual-sale-collection-fields";
import { openManualSalePaystackInline } from "./manual-sale-paystack-client";
import RequestPaymentModal from "@/app/dashboard/pos/request-payment-modal";

type RecordProductSalePaymentDialogProps = {
  incomeId: string;
  invoiceNo: string;
  outstanding: number;
  paymentMethods: string[];
  defaultEmail?: string;
  defaultPhone?: string;
  onClose: () => void;
  onSuccess?: () => void;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function RecordProductSalePaymentDialog({
  incomeId,
  invoiceNo,
  outstanding,
  defaultEmail = "",
  defaultPhone = "",
  onClose,
  onSuccess,
}: RecordProductSalePaymentDialogProps) {
  const router = useRouter();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  const [paymentDate, setPaymentDate] = useState(todayIsoDate());
  const [amount, setAmount] = useState(outstanding > 0 ? outstanding : 0);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [collectionMode, setCollectionMode] =
    useState<ManualSaleCollectionMode>("received");
  const [transactionReference, setTransactionReference] = useState("");
  const [payerEmail, setPayerEmail] = useState(defaultEmail);
  const [payerPhone, setPayerPhone] = useState(defaultPhone);
  const [linkOpen, setLinkOpen] = useState(false);

  function payerEmailReady(): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail.trim());
  }

  async function payNow() {
    if (!payerEmailReady()) {
      setSubmitting(false);
      await alertError(
        clientFacingSalesCrmError("Enter the payer's email address."),
        { title: SALES_CRM_ALERT_TITLE },
      );
      return;
    }
    if (!(amount > 0) || amount > outstanding + 0.001) {
      setSubmitting(false);
      await alertError(
        clientFacingSalesCrmError("Enter an amount within the outstanding balance."),
        { title: SALES_CRM_ALERT_TITLE },
      );
      return;
    }
    setSubmitting(true);
    const result = await openManualSalePaystackInline({
      invoice_no: invoiceNo,
      amount_ghs: amount,
      payment_method: paymentMethod,
      delivery_email: payerEmail.trim(),
    });
    setSubmitting(false);
    if (!result.ok) {
      await alertError(clientFacingSalesCrmError(result.error), {
        title: SALES_CRM_ALERT_TITLE,
      });
      return;
    }
    onSuccess?.();
    router.refresh();
    toast("Payment recorded");
    onClose();
  }

  async function sendLink() {
    if (!payerEmailReady() && !payerPhone.trim()) {
      setSubmitting(false);
      await alertError(
        clientFacingSalesCrmError("Enter the payer's email or phone number."),
        { title: SALES_CRM_ALERT_TITLE },
      );
      return;
    }
    setLinkOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const methodField = formRef.current?.elements.namedItem(
      "product_sale_payment_method",
    );
    if (
      isPaystackCollectMethod(paymentMethod) &&
      collectionMode === "paystack"
    ) {
      setSubmitting(false);
      await alertError(
        clientFacingSalesCrmError(
          "Use Pay now or Send payment link. The payment is recorded after Paystack confirms.",
        ),
        { title: SALES_CRM_ALERT_TITLE },
      );
      return;
    }
    if (
      methodField instanceof HTMLSelectElement &&
      !isManualSalePaymentMethod(paymentMethod)
    ) {
      methodField.setCustomValidity("Choose a payment method.");
      methodField.reportValidity();
      return;
    }

    if (!formRef.current?.reportValidity()) {
      return;
    }

    setSubmitting(true);

    const body: RecordProductSalePaymentBody = {
      payment_date: paymentDate,
      amount,
      payment_method: paymentMethod.trim() || null,
      notes: notes.trim() || null,
      transaction_reference:
        collectionMode === "received" ? transactionReference.trim() || null : null,
    };

    try {
      const response = await fetch(`/api/product-sales/${incomeId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setSubmitting(false);
        await alertError(
          clientFacingSalesCrmError(
            payload?.error ?? "Unable to record payment.",
          ),
          { title: SALES_CRM_ALERT_TITLE },
        );
        return;
      }

      onSuccess?.();
      router.refresh();
      toast("Payment recorded");
      onClose();
    } catch {
      setSubmitting(false);
      await alertError(
        clientFacingSalesCrmError(
          "Couldn't reach the server. Check your connection and try again.",
        ),
        { title: SALES_CRM_ALERT_TITLE },
      );
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="record-product-sale-payment-title"
    >
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <h3
          id="record-product-sale-payment-title"
          className="text-lg font-semibold text-[#0f2744]"
        >
          Record Payment
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Invoice {invoiceNo} — outstanding{" "}
          <span className="font-medium">{formatGHS(outstanding)}</span>
        </p>

        <form
          ref={formRef}
          onSubmit={(event) => void handleSubmit(event)}
          className="mt-4 space-y-4"
        >
          <div>
            <label
              htmlFor="product_sale_payment_date"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Payment date
            </label>
            <input
              id="product_sale_payment_date"
              type="date"
              required
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div>
            <label
              htmlFor="product_sale_payment_amount"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Amount (GHS)
            </label>
            <input
              id="product_sale_payment_amount"
              type="number"
              required
              min={0.01}
              step={0.01}
              max={outstanding}
              value={amount}
              onChange={(event) => {
                const next = Number(event.target.value);
                setAmount(next);
                if (!(next > 0)) {
                  setPaymentMethod("");
                  setCollectionMode("received");
                }
              }}
              className={inputClassName}
            />
          </div>

          {amount > 0 ? (
          <div>
            <label
              htmlFor="product_sale_payment_method"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Payment method
            </label>
            <select
              id="product_sale_payment_method"
              name="product_sale_payment_method"
              value={paymentMethod}
              onChange={(event) => {
                event.target.setCustomValidity("");
                setPaymentMethod(event.target.value);
                if (!isPaystackCollectMethod(event.target.value)) {
                  setCollectionMode("received");
                }
              }}
              className={inputClassName}
            >
              <option value="">Choose how the customer paid</option>
              {MANUAL_SALE_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          ) : null}

          <div>
            <label
              htmlFor="product_sale_payment_notes"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Notes (optional)
            </label>
            <textarea
              id="product_sale_payment_notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={inputClassName}
            />
          </div>

          <ManualSaleCollectionFields
            method={paymentMethod}
            amount={amount}
            mode={collectionMode}
            onMode={setCollectionMode}
            reference={transactionReference}
            onReference={setTransactionReference}
            email={payerEmail}
            onEmail={setPayerEmail}
            phone={payerPhone}
            onPhone={setPayerPhone}
          />

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            {isPaystackCollectMethod(paymentMethod) && collectionMode === "paystack" ? (
              <>
                <button
                  type="button"
                  disabled={submitting || outstanding <= 0}
                  onClick={() => void payNow()}
                  className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting ? "Opening Paystack…" : "Pay now"}
                </button>
                <button
                  type="button"
                  disabled={submitting || outstanding <= 0}
                  onClick={() => void sendLink()}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Send payment link
                </button>
              </>
            ) : (
            <button
              type="submit"
              disabled={submitting || outstanding <= 0}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Recording…" : "Record payment"}
            </button>
            )}
          </div>
        </form>
        {linkOpen ? (
          <RequestPaymentModal
            mode="invoice"
            invoiceNo={invoiceNo}
            paymentMethod={paymentMethod}
            defaultAmountGhs={amount}
            defaultEmail={payerEmail}
            defaultPhone={payerPhone}
            onClose={() => setLinkOpen(false)}
            onLinkSent={() => {
              setLinkOpen(false);
              onSuccess?.();
              router.refresh();
              toast("Payment link sent — this sale shows as Awaiting payment until Paystack confirms.");
              onClose();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
