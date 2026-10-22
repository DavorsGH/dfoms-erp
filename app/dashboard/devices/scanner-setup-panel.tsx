"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "@/app/dashboard/employees/employee-record-utils";
import { useScannerSetupProbe } from "@/hooks/use-scanner-setup-probe";
import {
  BARCODE_WEDGE_INPUT_ATTR,
  findProductByScanCode,
  parseBarcodeScanPayload,
} from "@/utils/barcode-scan-utils";
import type { FinishedProductRecord } from "@/app/dashboard/inventory/finished-products-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
} from "@/app/dashboard/inventory/finished-products-utils";
import { scopedFinishedProductsQuery } from "@/app/dashboard/inventory/finished-product-bu-stock-utils";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";

type ScannerSetupPanelProps = {
  initialProducts: FinishedProductRecord[];
  fetchError: string | null;
};

export default function ScannerSetupPanel({
  initialProducts,
  fetchError,
}: ScannerSetupPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const buReadScope = useBusinessUnitReadScope();
  const [products, setProducts] = useState(initialProducts);
  const [lookupError, setLookupError] = useState<string | null>(fetchError);
  const { sample, verdict, reset, interKeyMs, minLength } = useScannerSetupProbe();

  const lookupCode = sample?.receivedEnter
    ? parseBarcodeScanPayload(sample.rawValue)
    : "";
  const lookupProduct = lookupCode
    ? findProductByScanCode(products, lookupCode)
    : undefined;

  async function refreshProducts() {
    setLookupError(null);
    const { data, error } = await scopedFinishedProductsQuery(
      supabase,
      buReadScope,
      FINISHED_PRODUCT_SELECT,
    );
    if (error) {
      setLookupError(error.message);
      return;
    }
    setProducts(
      ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
        normalizeFinishedProduct(row),
      ),
    );
  }

  return (
    <div className="space-y-8">
      {lookupError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {lookupError}
        </p>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[#0f2744]">Scanner test</h2>
        <p className="mt-1 text-sm text-slate-600">
          Click in the box below and scan a barcode. This test uses the workspace
          scanner settings ({minLength} character minimum, {interKeyMs}ms max gap
          between keys).
        </p>

        <div className="mt-4 space-y-3">
          <div {...{ [BARCODE_WEDGE_INPUT_ATTR]: "probe" }}>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Test scan target
            </label>
            <input
              type="text"
              readOnly
              tabIndex={0}
              placeholder="Click here, then scan…"
              className={`${inputClassName} bg-slate-50 font-mono text-slate-800`}
              onFocus={reset}
            />
          </div>

          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-700">Scanned value</dt>
              <dd className="font-mono text-slate-900">{sample?.rawValue || "—"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Character count</dt>
              <dd>{sample?.charCount ?? 0}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Enter suffix received</dt>
              <dd>{sample?.receivedEnter ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-700">Average keystroke gap</dt>
              <dd>
                {sample?.averageInterKeyMs != null
                  ? `${Math.round(sample.averageInterKeyMs)} ms`
                  : "—"}
              </dd>
            </div>
          </dl>

          <p
            className={`rounded-md px-4 py-3 text-sm ${
              verdict.status === "ready"
                ? "border border-green-200 bg-green-50 text-green-900"
                : "border border-amber-200 bg-amber-50 text-amber-950"
            }`}
          >
            {verdict.message}
          </p>

          <button
            type="button"
            onClick={() => void refreshProducts()}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Refresh product lookup list
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[#0f2744]">Product lookup</h2>
        {lookupCode ? (
          lookupProduct ? (
            <p className="mt-2 text-sm text-slate-700">
              Matches{" "}
              <span className="font-medium">
                {lookupProduct.product_code} — {lookupProduct.product_name}
              </span>{" "}
              (barcode {lookupProduct.barcode || "—"}).
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-700">
              No product in this business scope matches code{" "}
              <span className="font-mono font-medium">{lookupCode}</span>.
            </p>
          )
        ) : (
          <p className="mt-2 text-sm text-slate-600">
            Complete a test scan to see whether the code matches a finished product.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-[#0f2744]">Setup steps</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>
            <span className="font-medium">USB scanners:</span> plug in, ensure the
            device is in USB HID keyboard mode (not virtual COM port).
          </li>
          <li>
            Program an Enter/CR suffix after each scan using the configuration barcode
            from the manufacturer manual.
          </li>
          <li>
            <span className="font-medium">Bluetooth scanners:</span> pair as a keyboard
            (HID), not as a serial device; then repeat the Enter suffix step.
          </li>
          <li>
            Return to POS checkout and scan items — each scan should add one line to the
            cart when stock allows.
          </li>
        </ol>
      </section>
    </div>
  );
}
