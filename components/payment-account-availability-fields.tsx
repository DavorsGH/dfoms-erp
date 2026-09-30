"use client";

import type { Dispatch, SetStateAction } from "react";
import type { BusinessUnitRow } from "@/utils/business-units-types";
import type {
  PaymentAccountAvailability,
  emptyPaymentAccountForm,
} from "@/utils/payment-accounts-types";
import { paymentAccountInputClassName } from "@/components/payment-account-form-fields";

type PaymentAccountFormState = ReturnType<typeof emptyPaymentAccountForm>;

type PaymentAccountAvailabilityFieldsProps = {
  form: PaymentAccountFormState;
  setForm: Dispatch<SetStateAction<PaymentAccountFormState>>;
  businessUnits: BusinessUnitRow[];
  disabled?: boolean;
  idPrefix?: string;
  /** When set, locks Selected to this unit only (business unit drawer — Add new). */
  lockedBusinessUnitId?: string | null;
};

export default function PaymentAccountAvailabilityFields({
  form,
  setForm,
  businessUnits,
  disabled = false,
  idPrefix = "payment-account",
  lockedBusinessUnitId,
}: PaymentAccountAvailabilityFieldsProps) {
  const activeUnits = businessUnits.filter((unit) => unit.is_active);
  const lockedId = lockedBusinessUnitId?.trim() || null;
  const availability: PaymentAccountAvailability = lockedId
    ? "selected"
    : form.availability;

  function setAvailability(next: PaymentAccountAvailability) {
    if (lockedId) {
      return;
    }
    setForm((current) => ({
      ...current,
      availability: next,
      business_unit_ids:
        next === "all"
          ? []
          : current.business_unit_ids.length > 0
            ? current.business_unit_ids
            : activeUnits.length === 1
              ? [activeUnits[0].id]
              : [],
    }));
  }

  function toggleUnit(unitId: string, checked: boolean) {
    setForm((current) => {
      const set = new Set(current.business_unit_ids);
      if (checked) {
        set.add(unitId);
      } else {
        set.delete(unitId);
      }
      return {
        ...current,
        availability: "selected",
        business_unit_ids: [...set],
      };
    });
  }

  const selectedIds = lockedId ? [lockedId] : form.business_unit_ids;

  return (
    <div className="md:col-span-2 space-y-3">
      <p className="text-sm font-medium text-slate-700">Available to</p>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="radio"
            name={`${idPrefix}-availability`}
            checked={availability === "all"}
            onChange={() => setAvailability("all")}
            disabled={disabled || Boolean(lockedId)}
            className="h-4 w-4 border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
          />
          All business units
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="radio"
            name={`${idPrefix}-availability`}
            checked={availability === "selected"}
            onChange={() => setAvailability("selected")}
            disabled={disabled}
            className="h-4 w-4 border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
          />
          Selected business units
        </label>
      </div>
      {availability === "selected" ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          {lockedId ? (
            <p className="text-sm text-slate-700">
              {activeUnits.find((unit) => unit.id === lockedId)?.name ??
                "This business unit"}
            </p>
          ) : activeUnits.length === 0 ? (
            <p className="text-sm text-slate-500">
              No active business units. Create a business unit first.
            </p>
          ) : (
            <div className="space-y-2">
              {activeUnits.map((unit) => (
                <label
                  key={unit.id}
                  className="flex items-center gap-2 text-sm text-slate-700"
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(unit.id)}
                    onChange={(event) =>
                      toggleUnit(unit.id, event.target.checked)
                    }
                    disabled={disabled}
                    className="h-4 w-4 rounded border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                  />
                  {unit.name}
                </label>
              ))}
            </div>
          )}
        </div>
      ) : null}
      {availability === "selected" &&
      !lockedId &&
      selectedIds.length === 0 &&
      activeUnits.length > 0 ? (
        <p className="text-xs text-amber-800">
          Select at least one business unit.
        </p>
      ) : null}
    </div>
  );
}
