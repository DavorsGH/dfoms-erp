"use client";

import {
  isPaystackCollectMethod,
  type ManualSaleCollectionMode,
} from "@/utils/manual-sale-paystack";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ManualSaleCollectionFields({
  method,
  amount,
  mode,
  onMode,
  reference,
  onReference,
  email,
  onEmail,
  phone,
  onPhone,
}: {
  method: string;
  amount: number;
  mode: ManualSaleCollectionMode;
  onMode: (mode: ManualSaleCollectionMode) => void;
  reference: string;
  onReference: (value: string) => void;
  email: string;
  onEmail: (value: string) => void;
  phone: string;
  onPhone: (value: string) => void;
}) {
  if (!(amount > 0) || !isPaystackCollectMethod(method)) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">
          How was this {method} payment taken?
        </legend>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="radio"
            name="manual_sale_collection"
            checked={mode === "received"}
            onChange={() => onMode("received")}
          />
          Already received
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="radio"
            name="manual_sale_collection"
            checked={mode === "paystack"}
            onChange={() => onMode("paystack")}
          />
          Collect now with Paystack
        </label>
      </fieldset>
      {mode === "received" ? (
        <div>
          <label
            htmlFor="manual_sale_transaction_ref"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Transaction / MoMo reference (optional)
          </label>
          <input
            id="manual_sale_transaction_ref"
            value={reference}
            onChange={(event) => onReference(event.target.value)}
            className={inputClassName}
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <p className="sm:col-span-2 text-xs text-slate-600">
            The sale or payment is recorded only after Paystack confirms. Cancelling
            the window records nothing.
          </p>
          <div>
            <label
              htmlFor="manual_sale_payer_email"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Payer email
            </label>
            <input
              id="manual_sale_payer_email"
              type="email"
              value={email}
              onChange={(event) => onEmail(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label
              htmlFor="manual_sale_payer_phone"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Payer phone
            </label>
            <input
              id="manual_sale_payer_phone"
              type="tel"
              value={phone}
              onChange={(event) => onPhone(event.target.value)}
              placeholder="024… or +233…"
              className={inputClassName}
            />
          </div>
        </div>
      )}
    </div>
  );
}
