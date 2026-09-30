"use client";

import type { Dispatch, SetStateAction } from "react";
import PaymentAccountAvailabilityFields from "@/components/payment-account-availability-fields";
import type { BusinessUnitRow } from "@/utils/business-units-types";
import type { emptyPaymentAccountForm } from "@/utils/payment-accounts-types";

export const paymentAccountInputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type PaymentAccountFormState = ReturnType<typeof emptyPaymentAccountForm>;

type PaymentAccountFormFieldsProps = {
  form: PaymentAccountFormState;
  setForm: Dispatch<SetStateAction<PaymentAccountFormState>>;
  businessUnits?: BusinessUnitRow[];
  showAvailabilityFields?: boolean;
  lockedBusinessUnitId?: string | null;
  disabled?: boolean;
  idPrefix?: string;
};

export default function PaymentAccountFormFields({
  form,
  setForm,
  businessUnits = [],
  showAvailabilityFields = false,
  lockedBusinessUnitId,
  disabled = false,
  idPrefix = "payment-account",
}: PaymentAccountFormFieldsProps) {
  return (
    <>
      <div className="md:col-span-2">
        <label
          htmlFor={`${idPrefix}-account-name`}
          className="mb-1 block text-sm font-medium text-slate-700"
        >
          Account Name *
        </label>
        <input
          id={`${idPrefix}-account-name`}
          type="text"
          required
          value={form.account_name}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              account_name: event.target.value,
            }))
          }
          placeholder="Davors Technologies Ltd"
          className={paymentAccountInputClassName}
          disabled={disabled}
        />
      </div>

      {showAvailabilityFields ? (
        <PaymentAccountAvailabilityFields
          form={form}
          setForm={setForm}
          businessUnits={businessUnits}
          disabled={disabled}
          idPrefix={idPrefix}
          lockedBusinessUnitId={lockedBusinessUnitId}
        />
      ) : null}

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Bank Name
        </label>
        <input
          type="text"
          value={form.bank_name}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              bank_name: event.target.value,
            }))
          }
          className={paymentAccountInputClassName}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Bank Account Number
        </label>
        <input
          type="text"
          value={form.bank_account_number}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              bank_account_number: event.target.value,
            }))
          }
          className={paymentAccountInputClassName}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          MoMo Merchant Name
        </label>
        <input
          type="text"
          value={form.momo_merchant_name}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              momo_merchant_name: event.target.value,
            }))
          }
          placeholder="Davors Enterprise"
          className={paymentAccountInputClassName}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          MoMo Provider
        </label>
        <input
          type="text"
          value={form.momo_provider}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              momo_provider: event.target.value,
            }))
          }
          placeholder="MTN, Vodafone, AirtelTigo"
          className={paymentAccountInputClassName}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Merchant Number
        </label>
        <input
          type="text"
          value={form.momo_number}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              momo_number: event.target.value,
            }))
          }
          className={paymentAccountInputClassName}
          disabled={disabled}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">
          Merchant ID
        </label>
        <input
          type="text"
          value={form.momo_merchant_id}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              momo_merchant_id: event.target.value,
            }))
          }
          className={paymentAccountInputClassName}
          disabled={disabled}
        />
      </div>

      <div className="flex items-center gap-2 md:col-span-2">
        <input
          id={`${idPrefix}-active`}
          type="checkbox"
          checked={form.is_active}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              is_active: event.target.checked,
            }))
          }
          className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
          disabled={disabled}
        />
        <label htmlFor={`${idPrefix}-active`} className="text-sm text-slate-700">
          Active (available for invoice use)
        </label>
      </div>
    </>
  );
}
