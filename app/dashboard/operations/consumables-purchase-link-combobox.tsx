"use client";

import { useEffect, useMemo, useState } from "react";
import { consumablesInputClassName } from "./consumables-store-client";
import type { ConsumablePurchaseLinkChoice } from "./consumables-purchase-link-utils";

type Value = { type: "expense" | "payable"; id: string } | null;

type Props = {
  value: Value;
  onChange: (value: Value) => void;
  fromSupplier: ConsumablePurchaseLinkChoice[];
  other: ConsumablePurchaseLinkChoice[];
  supplierName: string;
  disabled?: boolean;
};

function choiceKey(value: Value): string {
  if (!value) return "";
  return `${value.type}:${value.id}`;
}

export default function ConsumablesPurchaseLinkCombobox({
  value,
  onChange,
  fromSupplier,
  other,
  supplierName,
  disabled,
}: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const allChoices = useMemo(
    () => [...fromSupplier, ...other],
    [fromSupplier, other],
  );

  const selected = useMemo(
    () => allChoices.find((row) => row.key === choiceKey(value)) ?? null,
    [allChoices, value],
  );

  useEffect(() => {
    if (selected) {
      setQuery(selected.label);
    } else if (!value) {
      setQuery("");
    }
  }, [selected, value]);

  const filteredFromSupplier = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (selected && query === selected.label)) {
      return fromSupplier;
    }
    return fromSupplier.filter((row) => row.searchText.includes(q));
  }, [fromSupplier, query, selected]);

  const filteredOther = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (selected && query === selected.label)) {
      return other;
    }
    return other.filter((row) => row.searchText.includes(q));
  }, [other, query, selected]);

  const hasAny = fromSupplier.length + other.length > 0;
  const showList =
    open &&
    !disabled &&
    (filteredFromSupplier.length > 0 || filteredOther.length > 0);

  function pick(row: ConsumablePurchaseLinkChoice) {
    onChange({ type: row.type, id: row.id });
    setQuery(row.label);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setQuery("");
    setOpen(false);
  }

  const emptyMessage = supplierName
    ? `No purchases from ${supplierName} in the last 120 days`
    : null;
  const globalEmpty = !hasAny
    ? "No expenses or bills in the last 120 days in this business unit"
    : null;

  return (
    <div className="relative space-y-1">
      <div className="flex gap-2">
        <input
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder="Search expenses and bills…"
          className={consumablesInputClassName}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (value) {
              onChange(null);
            }
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 150);
          }}
        />
        {value ? (
          <button
            type="button"
            className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700"
            onClick={clear}
            disabled={disabled}
          >
            Clear
          </button>
        ) : null}
      </div>
      {showList ? (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full max-w-2xl overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filteredFromSupplier.length > 0 ? (
            <>
              <li className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                From {supplierName || "supplier"}
              </li>
              {filteredFromSupplier.map((row) => (
                <li key={row.key} role="option">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(row)}
                  >
                    {row.label}
                  </button>
                </li>
              ))}
            </>
          ) : null}
          {filteredOther.length > 0 ? (
            <>
              <li className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Other purchases
              </li>
              {filteredOther.map((row) => (
                <li key={row.key} role="option">
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(row)}
                  >
                    {row.label}
                  </button>
                </li>
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
      {!open && globalEmpty ? (
        <p className="text-xs text-slate-600">{globalEmpty}</p>
      ) : null}
      {!open &&
      !globalEmpty &&
      supplierName &&
      fromSupplier.length === 0 &&
      other.length > 0 ? (
        <p className="text-xs text-slate-600">{emptyMessage}</p>
      ) : null}
      {!open &&
      !globalEmpty &&
      supplierName &&
      fromSupplier.length === 0 &&
      other.length === 0 ? (
        <p className="text-xs text-slate-600">{emptyMessage}</p>
      ) : null}
    </div>
  );
}
