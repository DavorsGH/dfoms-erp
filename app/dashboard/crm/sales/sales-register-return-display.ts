import type { ProductSaleEntry } from "../product-sales-utils";
import { formatCreditNoteUsageStatus } from "../../finance/credit-note-display-utils";

export type ReturnRefundSummary = {
  method: string;
  amount: number;
  refund_date: string;
};

export type ReturnCreditNoteMeta = {
  return_mode: string | null;
  status: string | null;
  refunded_amount: number;
  applied_amount: number;
  total_amount: number;
};

export function creditNoteMetaFromEntry(
  entry: ProductSaleEntry,
): ReturnCreditNoteMeta | null {
  const raw = entry.credit_note;
  const cn = Array.isArray(raw) ? raw[0] ?? null : raw ?? null;
  if (!cn) {
    return null;
  }
  return {
    return_mode: cn.return_mode ?? null,
    status: cn.status ?? null,
    refunded_amount: Number(cn.refunded_amount) || 0,
    applied_amount: Number(cn.applied_amount) || 0,
    total_amount: Number(cn.total_amount) || 0,
  };
}

export function formatReturnRowPaymentMethod(
  meta: ReturnCreditNoteMeta | null | undefined,
  refunds: ReturnRefundSummary[],
): string {
  const mode = meta?.return_mode?.trim().toLowerCase() ?? "";
  if (mode === "store_credit") {
    return "Store credit";
  }
  if (mode === "exchange_hold") {
    return "Exchange credit";
  }
  if (mode === "refund_now") {
    const method = refunds[0]?.method?.trim();
    return method ? `Refund – ${method}` : "Refund";
  }
  return "—";
}

export function formatReturnRowPaymentStatus(
  meta: ReturnCreditNoteMeta | null | undefined,
): string {
  if (!meta) {
    return "Credit note";
  }
  return formatCreditNoteUsageStatus(meta);
}

export function formatCreditNoteOutcomeLabel(returnMode: string | null | undefined): string {
  const mode = returnMode?.trim().toLowerCase() ?? "";
  if (mode === "store_credit") {
    return "Store credit";
  }
  if (mode === "exchange_hold") {
    return "Exchange credit";
  }
  if (mode === "refund_now") {
    return "Refund now";
  }
  return "Credit note";
}
