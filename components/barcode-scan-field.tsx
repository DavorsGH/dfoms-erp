"use client";

import { useState } from "react";
import { useBarcodeScannerWedge } from "@/hooks/use-barcode-scanner-wedge";
import { parseBarcodeScanPayload } from "@/utils/barcode-scan-utils";
import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";

type BarcodeScanFieldProps = {
  onScan: (parsedCode: string, rawPayload: string) => void;
  enabled?: boolean;
  paused?: boolean;
  label?: string;
  hint?: string;
  errorMessage?: string | null;
  successMessage?: string | null;
};

export function BarcodeScanStatus({
  label = "Barcode scanner",
  hint = "Scan a barcode with your scanner, or type a code and press Enter.",
  errorMessage,
  successMessage,
}: Pick<
  BarcodeScanFieldProps,
  "label" | "hint" | "errorMessage" | "successMessage"
>) {
  return (
    <div className="space-y-1">
      <label className="mb-1 block text-sm font-medium text-slate-700">
        {label}
      </label>
      <div
        className={`${inputClassName} bg-slate-50 text-slate-600`}
        aria-live="polite"
      >
        {successMessage ?? hint}
      </div>
      {errorMessage ? (
        <p className="text-sm text-red-700">{errorMessage}</p>
      ) : null}
    </div>
  );
}

function deliverScan(
  onScan: BarcodeScanFieldProps["onScan"],
  rawPayload: string,
) {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    return;
  }
  onScan(parseBarcodeScanPayload(trimmed), trimmed);
}

/** Manual barcode entry when the wedge scanner is unavailable or malfunctioning. */
export function BarcodeManualEntry({
  enabled = true,
  paused = false,
  onScan,
}: Pick<BarcodeScanFieldProps, "enabled" | "paused" | "onScan">) {
  const [manualCode, setManualCode] = useState("");

  function submitManual() {
    if (!enabled || paused) {
      return;
    }
    deliverScan(onScan, manualCode);
    setManualCode("");
  }

  if (!enabled) {
    return null;
  }

  return (
    <div className="mt-2 space-y-1">
      <label className="block text-xs font-medium text-slate-600">
        Enter code manually
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={manualCode}
          onChange={(event) => setManualCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submitManual();
            }
          }}
          placeholder="Type barcode or label payload, then Enter"
          className={`${inputClassName} min-w-[12rem] flex-1`}
          disabled={paused}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={submitManual}
          disabled={paused || !manualCode.trim()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Submit
        </button>
      </div>
    </div>
  );
}

export default function BarcodeScanField({
  onScan,
  enabled = true,
  paused = false,
  label = "Barcode scanner",
  hint = "Scan a barcode with your scanner, or type a code and press Enter.",
  errorMessage,
  successMessage,
}: BarcodeScanFieldProps) {
  useBarcodeScannerWedge({
    enabled,
    paused,
    onScan: (rawPayload) => {
      deliverScan(onScan, rawPayload);
    },
  });

  return (
    <div className="space-y-1">
      <BarcodeScanStatus
        label={label}
        hint={hint}
        errorMessage={errorMessage}
        successMessage={successMessage}
      />
      <BarcodeManualEntry
        enabled={enabled}
        paused={paused}
        onScan={onScan}
      />
    </div>
  );
}
