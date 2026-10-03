"use client";

import { useEffect, useRef } from "react";
import type { SpreadsheetSheetSummary } from "@/lib/spreadsheet/parse-spreadsheet-client";

type SpreadsheetSheetSelectorProps = {
  summaries: SpreadsheetSheetSummary[];
  value: string;
  onChange: (sheetName: string) => void;
  disabled?: boolean;
};

export default function SpreadsheetSheetSelector({
  summaries,
  value,
  onChange,
  disabled = false,
}: SpreadsheetSheetSelectorProps) {
  const selectedItemRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (!value) {
      return;
    }

    selectedItemRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [value, summaries.length]);

  if (summaries.length <= 1) {
    return null;
  }

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-sm font-medium text-[#0f2744]">
        Which sheet should we import?
      </p>
      <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto pr-1">
        {summaries.map((sheet) => {
          const selected = sheet.name === value;
          return (
            <li
              key={sheet.name}
              ref={selected ? selectedItemRef : undefined}
            >
              <label
                className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm transition-colors ${
                  selected
                    ? "border-[#0f2744] bg-[#0f2744]/10 text-slate-900 ring-1 ring-[#0f2744]/30"
                    : "border-transparent text-slate-700 hover:bg-white/80"
                } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type="radio"
                  name="spreadsheet-sheet"
                  value={sheet.name}
                  checked={selected}
                  disabled={disabled}
                  onChange={() => onChange(sheet.name)}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium text-slate-900">{sheet.name}</span>
                  <span className="block text-xs text-slate-600">
                    {sheet.dataRowCount.toLocaleString()} data row
                    {sheet.dataRowCount === 1 ? "" : "s"}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
