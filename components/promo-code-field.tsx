"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import {
  applyPromoDiscount,
  fetchActivePromoCodeOptions,
  type PromoCodeOption,
  type PromoSourceType,
} from "@/utils/promo-discount-utils";

type PromoCodeFieldProps = {
  supabase: SupabaseClient;
  clientId: string | null;
  orderAmount: number;
  sourceType: PromoSourceType;
  sourceReference?: string | null;
  appliedCode: string | null;
  appliedDiscount: number;
  onApplied: (code: string, discountAmount: number) => void;
  onClear: () => void;
  disabled?: boolean;
};

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const listboxClassName =
  "absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg";

const listOptionClassName =
  "block w-full px-3 py-2 text-left text-sm text-slate-900 hover:bg-slate-50";

export default function PromoCodeField({
  supabase,
  clientId,
  orderAmount,
  sourceType,
  sourceReference = null,
  appliedCode,
  appliedDiscount,
  onApplied,
  onClear,
  disabled = false,
}: PromoCodeFieldProps) {
  const [code, setCode] = useState(appliedCode ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<PromoCodeOption[]>([]);
  /** True after a successful options fetch (including an empty active list). */
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    setCode(appliedCode ?? "");
  }, [appliedCode]);

  useEffect(() => {
    let cancelled = false;

    async function loadOptions() {
      if (disabled) {
        setOptions([]);
        setOptionsLoaded(false);
        setOptionsLoading(false);
        return;
      }

      setOptionsLoading(true);
      setOptionsLoaded(false);

      const result = await fetchActivePromoCodeOptions(supabase, sourceType);
      if (cancelled) {
        return;
      }

      if (result.error) {
        // Optional picker — fail quietly; manual entry + Apply still work.
        setOptions([]);
        setOptionsLoaded(false);
      } else {
        setOptions(result.options);
        setOptionsLoaded(true);
      }
      setOptionsLoading(false);
    }

    void loadOptions();

    return () => {
      cancelled = true;
    };
  }, [sourceType, supabase, disabled]);

  const filteredOptions = useMemo(() => {
    const query = code.trim().toUpperCase();
    if (!query) {
      return options;
    }

    return options.filter(
      (option) =>
        option.code.toUpperCase().includes(query) ||
        option.name.toUpperCase().includes(query) ||
        option.label.toUpperCase().includes(query),
    );
  }, [code, options]);

  async function handleApply() {
    setLoading(true);
    setError(null);
    setListOpen(false);

    const result = await applyPromoDiscount(supabase, {
      code,
      clientId,
      orderAmount,
      sourceType,
      sourceReference,
    });

    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    onApplied(code.trim().toUpperCase(), result.discountAmount);
    setLoading(false);
  }

  function handleClear() {
    setCode("");
    setError(null);
    setListOpen(false);
    onClear();
  }

  function selectOption(option: PromoCodeOption) {
    setCode(option.code);
    setError(null);
    setListOpen(false);
  }

  const inputDisabled = disabled || loading || Boolean(appliedCode);
  const showList =
    listOpen && !appliedCode && !inputDisabled && filteredOptions.length > 0;

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-medium text-[#0f2744]">Promo Code</p>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <input
            type="text"
            role="combobox"
            aria-expanded={showList}
            aria-autocomplete="list"
            aria-controls="promo-code-options"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.toUpperCase());
              setError(null);
              setListOpen(true);
            }}
            onFocus={() => setListOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setListOpen(false), 150);
            }}
            placeholder={
              optionsLoading
                ? "Loading codes…"
                : options.length > 0
                  ? "Search or select a code"
                  : "Enter code"
            }
            disabled={inputDisabled}
            className={inputClassName}
            autoComplete="off"
          />
          {showList ? (
            <ul id="promo-code-options" role="listbox" className={listboxClassName}>
              {filteredOptions.map((option) => (
                <li key={option.code} role="option">
                  <button
                    type="button"
                    className={listOptionClassName}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectOption(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {appliedCode ? (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled || loading}
            className={secondaryButtonClassName}
          >
            Remove
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={disabled || loading || !code.trim() || orderAmount <= 0}
            className={secondaryButtonClassName}
          >
            {loading ? "Applying…" : "Apply"}
          </button>
        )}
      </div>
      {optionsLoaded && !optionsLoading && options.length === 0 ? (
        <p className="text-xs text-slate-500">
          No active promo codes for this sale type — enter a code manually.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-700">{error}</p>
      ) : null}
      {appliedCode && appliedDiscount > 0 ? (
        <p className="text-sm text-emerald-800">
          {appliedCode} applied — discount {formatGHS(appliedDiscount)}
        </p>
      ) : null}
    </div>
  );
}
