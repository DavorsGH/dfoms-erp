"use client";

import { useState } from "react";
import type { SpreadsheetSheetSummary } from "@/lib/spreadsheet/parse-spreadsheet-client";
import { SPREADSHEET_HEADER_SEARCH_MAX_ROWS } from "@/lib/spreadsheet/spreadsheet-header-detection";
import SpreadsheetSheetSelector from "@/components/spreadsheet-sheet-selector";

type SpreadsheetImportSheetOptionsProps = {
  summaries: SpreadsheetSheetSummary[];
  selectedSheetName: string;
  onSheetChange: (sheetName: string) => void;
  /** Resolved 0-based header row for the selected sheet. */
  headerRowIndex: number;
  detectedHeaderRowIndex: number;
  onHeaderRowIndexChange: (headerRowIndex: number) => void;
  disabled?: boolean;
};

export default function SpreadsheetImportSheetOptions({
  summaries,
  selectedSheetName,
  onSheetChange,
  headerRowIndex,
  detectedHeaderRowIndex,
  onHeaderRowIndexChange,
  disabled = false,
}: SpreadsheetImportSheetOptionsProps) {
  const [editingHeaderRow, setEditingHeaderRow] = useState(false);

  const showSheetPicker = summaries.length > 1;
  const showHeaderRow = selectedSheetName.length > 0;

  if (!showSheetPicker && !showHeaderRow) {
    return null;
  }

  const headerRowOptions = Array.from(
    { length: SPREADSHEET_HEADER_SEARCH_MAX_ROWS },
    (_, index) => index,
  );

  return (
    <div className="space-y-3">
      <SpreadsheetSheetSelector
        summaries={summaries}
        value={selectedSheetName}
        onChange={onSheetChange}
        disabled={disabled}
      />

      {showHeaderRow ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Column names found in row{" "}
              <span className="font-medium text-slate-900">
                {headerRowIndex + 1}
              </span>
              {headerRowIndex === detectedHeaderRowIndex ? (
                <span className="text-xs text-slate-500"> (auto-detected)</span>
              ) : null}
            </span>
            {editingHeaderRow ? (
              <label className="inline-flex items-center gap-2">
                <span className="text-xs text-slate-600">Header row</span>
                <select
                  value={headerRowIndex}
                  disabled={disabled}
                  onChange={(event) => {
                    onHeaderRowIndexChange(Number(event.target.value));
                    setEditingHeaderRow(false);
                  }}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
                >
                  {headerRowOptions.map((index) => (
                    <option key={index} value={index}>
                      Row {index + 1}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => setEditingHeaderRow(true)}
                className="text-xs font-medium text-[#0f2744] underline-offset-2 hover:underline disabled:opacity-50"
              >
                Change
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
