"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { buildPosStoreCreditCheckoutUrl } from "@/app/dashboard/pos/pos-store-credit-utils";
import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { formatInventoryQuantity } from "@/app/dashboard/inventory/inventory-utils";
import { useBusinessUnitView } from "@/app/dashboard/business-unit-view-context";
import { loadWriteBusinessUnitContext } from "@/utils/business-unit-access";
import {
  buildProductReturnLinesPayload,
  defaultProductReturnDate,
  evaluateReturnBusinessUnitGate,
  formatProductReturnRpcError,
  resolveProductReturnRpcBusinessUnitId,
  loadProductReturnReceiptContext,
  productReturnOutcomeCustomerMessage,
  PRODUCT_RETURN_EXPLAINER,
  summarizeProductReturn,
  type ProductReturnOutcome,
  type ProductReturnReceiptLine,
  type ProductReturnRpcResult,
} from "./product-return-utils";

type ProductReturnModalProps = {
  invoiceNo: string;
  tenantId: string;
  paymentMethods: string[];
  onClose: () => void;
  onSuccess: (result: {
    creditNoteId: string | null;
    creditNoteNumber: string;
    outcome: ProductReturnOutcome;
    refundMethod?: string;
  }) => void;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ProductReturnModal({
  invoiceNo,
  tenantId,
  paymentMethods,
  onClose,
  onSuccess,
}: ProductReturnModalProps) {
  const supabase = createClient();
  const { viewAllBusinessUnits, activeBusinessUnitId, units } =
    useBusinessUnitView();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saleBusinessUnitId, setSaleBusinessUnitId] = useState<string | null>(
    null,
  );
  const [receiptClientId, setReceiptClientId] = useState<string | null>(null);
  const [lines, setLines] = useState<ProductReturnReceiptLine[]>([]);
  const [reason, setReason] = useState("");
  const [returnDate, setReturnDate] = useState(defaultProductReturnDate());
  const [outcome, setOutcome] = useState<ProductReturnOutcome>("store_credit");
  const [refundMethod, setRefundMethod] = useState(paymentMethods[0] ?? "Cash");
  const [refundNotes, setRefundNotes] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{
    creditNoteId: string | null;
    creditNoteNumber: string;
    outcome: ProductReturnOutcome;
    refundMethod?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(null);
      const result = await loadProductReturnReceiptContext(supabase, {
        tenantId,
        invoiceNo,
      });
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.error);
        setLoading(false);
        return;
      }
      setSaleBusinessUnitId(result.saleBusinessUnitId);
      setReceiptClientId(result.clientId);
      setLines(result.lines);
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, tenantId, invoiceNo]);

  const buGate = useMemo(
    () =>
      evaluateReturnBusinessUnitGate({
        viewAllBusinessUnits,
        activeBusinessUnitId,
        saleBusinessUnitId,
        units,
      }),
    [viewAllBusinessUnits, activeBusinessUnitId, saleBusinessUnitId, units],
  );

  const summary = useMemo(() => summarizeProductReturn(lines), [lines]);

  const hasReturnQty = summary.totalValue > 0;

  function updateLine(
    incomeRegisterId: string,
    patch: Partial<Pick<ProductReturnReceiptLine, "returnQuantity" | "disposition">>,
  ) {
    setLines((prev) =>
      prev.map((line) => {
        if (line.incomeRegisterId !== incomeRegisterId) {
          return line;
        }
        const nextQty =
          patch.returnQuantity != null ? patch.returnQuantity : line.returnQuantity;
        const clamped = Math.min(
          Math.max(0, nextQty),
          line.quantityRemaining,
        );
        return {
          ...line,
          ...patch,
          returnQuantity: clamped,
        };
      }),
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);

    if (!buGate.ok) {
      setSubmitError(buGate.message);
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setSubmitError("Return reason is required.");
      return;
    }

    const payloadLines = buildProductReturnLinesPayload(lines);
    if (payloadLines.length === 0) {
      setSubmitError("Enter a return quantity on at least one line.");
      return;
    }

    if (outcome === "refund_now" && !refundMethod.trim()) {
      setSubmitError("Choose a refund payment method.");
      return;
    }

    setSubmitting(true);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setSubmitError(buContext.error);
      setSubmitting(false);
      return;
    }

    if (buContext.tenantId !== tenantId) {
      setSubmitError("Workspace session does not match this sale.");
      setSubmitting(false);
      return;
    }

    const pBusinessUnitId = resolveProductReturnRpcBusinessUnitId({
      saleBusinessUnitId,
      activeBusinessUnitId,
      units,
    });

    let rpcError: { message: string } | null = null;
    let data: ProductReturnRpcResult | null = null;

    if (outcome === "refund_now") {
      const response = await supabase.rpc("pos_product_return_and_refund_now", {
        p_tenant_id: tenantId,
        p_business_unit_id: pBusinessUnitId,
        p_return_date: returnDate,
        p_pos_invoice_no: invoiceNo.trim(),
        p_reason: trimmedReason,
        p_lines: payloadLines,
        p_refund_method: refundMethod.trim(),
        p_refund_notes: refundNotes.trim() || null,
      });
      rpcError = response.error;
      data = response.data as ProductReturnRpcResult | null;
    } else if (outcome === "store_credit") {
      const response = await supabase.rpc("pos_product_return_store_credit", {
        p_tenant_id: tenantId,
        p_business_unit_id: pBusinessUnitId,
        p_return_date: returnDate,
        p_pos_invoice_no: invoiceNo.trim(),
        p_reason: trimmedReason,
        p_lines: payloadLines,
      });
      rpcError = response.error;
      data = response.data as ProductReturnRpcResult | null;
    } else {
      const response = await supabase.rpc("pos_product_return_for_exchange", {
        p_tenant_id: tenantId,
        p_business_unit_id: pBusinessUnitId,
        p_return_date: returnDate,
        p_pos_invoice_no: invoiceNo.trim(),
        p_reason: trimmedReason,
        p_lines: payloadLines,
      });
      rpcError = response.error;
      data = response.data as ProductReturnRpcResult | null;
    }

    if (rpcError) {
      setSubmitError(formatProductReturnRpcError(rpcError.message));
      setSubmitting(false);
      return;
    }

    const creditNoteNumber =
      data?.credit_note_number?.trim() || "Credit note issued";

    const successPayload = {
      creditNoteId: data?.credit_note_id?.trim() || null,
      creditNoteNumber,
      outcome,
      refundMethod: outcome === "refund_now" ? refundMethod.trim() : undefined,
    };
    setSuccess(successPayload);
    setSubmitting(false);
    onSuccess(successPayload);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-return-title"
    >
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2
            id="product-return-title"
            className="text-lg font-semibold text-[#0f2744]"
          >
            Return — {invoiceNo}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{PRODUCT_RETURN_EXPLAINER}</p>
        </div>

        {loading ? (
          <p className="px-6 py-8 text-sm text-slate-600">Loading receipt lines…</p>
        ) : loadError ? (
          <div className="space-y-4 px-6 py-6">
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {loadError}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        ) : success ? (
          <ReturnSuccessPanel
            success={success}
            hasClientId={Boolean(receiptClientId?.trim())}
            onClose={onClose}
          />
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5 px-6 py-5">
            {!buGate.ok ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                {buGate.message}
              </p>
            ) : null}

            <ScrollableLinesTable lines={lines} onUpdateLine={updateLine} />

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reason <span className="text-red-600">*</span>
                </label>
                <textarea
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  className={inputClassName}
                  placeholder="Why is the customer returning these items?"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Return date
                </label>
                <input
                  type="date"
                  required
                  value={returnDate}
                  onChange={(e) => setReturnDate(e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Outcome</legend>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="return-outcome"
                  checked={outcome === "refund_now"}
                  onChange={() => setOutcome("refund_now")}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Refund now</span>
                  <span className="block text-slate-500">
                    Cash or other payment method out of the till / bank.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="return-outcome"
                  checked={outcome === "store_credit"}
                  onChange={() => setOutcome("store_credit")}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Keep as store credit</span>
                  <span className="block text-slate-500">
                    Liability on the customer for a future purchase.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="return-outcome"
                  checked={outcome === "exchange_hold"}
                  onChange={() => setOutcome("exchange_hold")}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">Exchange (credit held for the next sale)</span>
                  <span className="block text-slate-500">
                    Credit is held for the customer&apos;s next purchase.
                  </span>
                </span>
              </label>
            </fieldset>

            {outcome === "refund_now" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Refund payment method
                  </label>
                  <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                    className={inputClassName}
                  >
                    {paymentMethods.length === 0 ? (
                      <option value="Cash">Cash</option>
                    ) : (
                      paymentMethods.map((method) => (
                        <option key={method} value={method}>
                          {method}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Refund notes (optional)
                  </label>
                  <input
                    type="text"
                    value={refundNotes}
                    onChange={(e) => setRefundNotes(e.target.value)}
                    className={inputClassName}
                  />
                </div>
              </div>
            ) : null}

            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <p>
                <span className="font-medium text-[#0f2744]">Return value:</span>{" "}
                {formatGHS(summary.totalValue)}
              </p>
              <p className="mt-1">
                <span className="font-medium text-[#0f2744]">Stock:</span>{" "}
                {summary.restockQty > 0
                  ? `${formatInventoryQuantity(summary.restockQty)} restocked (sellable)`
                  : "No restock"}
                {summary.writeoffQty > 0
                  ? ` · ${formatInventoryQuantity(summary.writeoffQty)} written off as damaged`
                  : ""}
              </p>
              <p className="mt-1">
                <span className="font-medium text-[#0f2744]">Cash:</span>{" "}
                {outcome === "refund_now" && hasReturnQty
                  ? `${formatGHS(summary.totalValue)} refund via ${refundMethod.trim() || "Cash"}`
                  : "No cash movement (credit only)"}
              </p>
            </div>

            {submitError ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {submitError}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-4">
              <button
                type="submit"
                disabled={submitting || !buGate.ok}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Processing…" : "Complete return"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function ScrollableLinesTable({
  lines,
  onUpdateLine,
}: {
  lines: ProductReturnReceiptLine[];
  onUpdateLine: (
    incomeRegisterId: string,
    patch: Partial<Pick<ProductReturnReceiptLine, "returnQuantity" | "disposition">>,
  ) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2">Sold</th>
            <th className="px-3 py-2">Returned</th>
            <th className="px-3 py-2">Remaining</th>
            <th className="px-3 py-2">Qty to return</th>
            <th className="px-3 py-2">Condition</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200">
          {lines.map((line) => (
            <tr key={line.incomeRegisterId}>
              <td className="px-3 py-2 font-medium text-[#0f2744]">
                {line.productLabel}
              </td>
              <td className="px-3 py-2">
                {formatInventoryQuantity(line.quantitySold)}
                {line.unitOfMeasure ? ` ${line.unitOfMeasure}` : ""}
              </td>
              <td className="px-3 py-2">
                {formatInventoryQuantity(line.quantityAlreadyReturned)}
              </td>
              <td className="px-3 py-2">
                {formatInventoryQuantity(line.quantityRemaining)}
              </td>
              <td className="px-3 py-2">
                <input
                  type="number"
                  min={0}
                  max={line.quantityRemaining}
                  step="any"
                  disabled={line.quantityRemaining <= 0}
                  value={line.returnQuantity || ""}
                  onChange={(e) =>
                    onUpdateLine(line.incomeRegisterId, {
                      returnQuantity: Number(e.target.value) || 0,
                    })
                  }
                  className="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm"
                />
              </td>
              <td className="px-3 py-2">
                <select
                  value={line.disposition}
                  disabled={line.quantityRemaining <= 0}
                  onChange={(e) =>
                    onUpdateLine(line.incomeRegisterId, {
                      disposition: e.target.value as "restock" | "writeoff",
                    })
                  }
                  className="min-w-[10rem] rounded-md border border-slate-300 px-2 py-1 text-sm"
                >
                  <option value="restock">Restock (sellable)</option>
                  <option value="writeoff">Damaged / write-off</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReturnSuccessPanel({
  success,
  hasClientId,
  onClose,
}: {
  success: {
    creditNoteId: string | null;
    creditNoteNumber: string;
    outcome: ProductReturnOutcome;
    refundMethod?: string;
  };
  hasClientId: boolean;
  onClose: () => void;
}) {
  const copy = productReturnOutcomeCustomerMessage({
    outcome: success.outcome,
    creditNoteNumber: success.creditNoteNumber,
    hasClientId,
    refundMethod: success.refundMethod,
  });
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(success.creditNoteNumber);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4 px-6 py-6">
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        <p className="font-medium">{copy.headline}</p>
        <p className="mt-2">{copy.detail}</p>
        {copy.emphasizeCreditNote ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-lg font-semibold tracking-wide text-[#0f2744]">
              {success.creditNoteNumber}
            </span>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="rounded-md border border-emerald-400 bg-white px-3 py-1.5 text-sm font-medium text-emerald-950 hover:bg-emerald-100"
            >
              {copied ? "Copied" : "Copy number"}
            </button>
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3">
        {success.creditNoteId &&
        (success.outcome === "store_credit" ||
          success.outcome === "exchange_hold") ? (
          <>
            <Link
              href={buildPosStoreCreditCheckoutUrl({
                creditNoteId: success.creditNoteId,
              })}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c]"
            >
              Continue to POS
            </Link>
            <Link
              href={buildPosStoreCreditCheckoutUrl({
                creditNoteId: success.creditNoteId,
                loadLines: true,
              })}
              className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
            >
              Load returned items into cart
            </Link>
          </>
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Done
        </button>
      </div>
    </div>
  );
}
