"use client";

import { useMemo } from "react";
import {
  UNIT_OF_MEASURE_OTHER,
  UNITS_OF_MEASURE_PRESETS,
  resolveUnitOfMeasureFromForm,
  unitOfMeasureFormFromStored,
  unitOfMeasureOtherOptionLabel,
} from "@/utils/units-of-measure";

export const unitOfMeasureSelectInputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

type UnitOfMeasureSelectProps = {
  value: string;
  onChange: (storedValue: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  otherInputClassName?: string;
  id?: string;
};

export function UnitOfMeasureSelect({
  value,
  onChange,
  label = "Unit of measure",
  required = false,
  disabled = false,
  className = unitOfMeasureSelectInputClassName,
  otherInputClassName = unitOfMeasureSelectInputClassName,
  id,
}: UnitOfMeasureSelectProps) {
  const stored = value?.trim() ?? "";
  const { preset, other } = useMemo(
    () => unitOfMeasureFormFromStored(stored),
    [stored],
  );

  const showLegacyOtherHint =
    preset === UNIT_OF_MEASURE_OTHER && other.length > 0;

  function handlePresetChange(nextPreset: string) {
    if (nextPreset === UNIT_OF_MEASURE_OTHER) {
      onChange(other || stored);
      return;
    }
    onChange(nextPreset);
  }

  function handleOtherChange(nextOther: string) {
    onChange(resolveUnitOfMeasureFromForm(UNIT_OF_MEASURE_OTHER, nextOther));
  }

  const selectId = id ?? "unit-of-measure";

  return (
    <div className="space-y-2">
      {label ? (
        <label htmlFor={selectId} className="mb-1 block text-sm font-medium">
          {label}
          {required ? " *" : null}
        </label>
      ) : null}
      <select
        id={selectId}
        required={required}
        disabled={disabled}
        className={className}
        value={preset}
        onChange={(event) => handlePresetChange(event.target.value)}
      >
        {UNITS_OF_MEASURE_PRESETS.map((unit) => (
          <option key={unit} value={unit}>
            {unit}
          </option>
        ))}
        <option value={UNIT_OF_MEASURE_OTHER}>
          {showLegacyOtherHint
            ? unitOfMeasureOtherOptionLabel(other)
            : "Other"}
        </option>
      </select>
      {preset === UNIT_OF_MEASURE_OTHER ? (
        <input
          type="text"
          required={required}
          disabled={disabled}
          className={otherInputClassName}
          value={other}
          onChange={(event) => handleOtherChange(event.target.value)}
          placeholder="Enter unit"
          aria-label={`${label} (other)`}
        />
      ) : null}
    </div>
  );
}
