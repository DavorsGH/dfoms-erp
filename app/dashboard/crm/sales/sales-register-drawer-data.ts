import type { SupabaseClient } from "@supabase/supabase-js";
import { formatGHS, formatDate } from "@/app/dashboard/finance/income-register-utils";
import {
  resolveStoredProductSalePaymentMethod,
  type SalesRegisterReceiptRow,
} from "./sales-register-utils";
import { getProductSaleProductLabel } from "../product-sales-utils";
import {
  PRODUCT_SALE_PAYMENT_SELECT,
  type ProductSalePaymentRow,
} from "@/utils/product-sale-payments-types";
import {
  formatCreditNoteOutcomeLabel,
  type ReturnRefundSummary,
} from "./sales-register-return-display";
import { formatCreditNoteUsageStatus } from "../../finance/credit-note-display-utils";

export type SalesRegisterDrawerPayment = {
  key: string;
  label: string;
  amount: number;
  method: string;
  date: string;
};

export type SalesRegisterDrawerReturnLine = {
  productLabel: string;
  quantity: number;
};

export type SalesRegisterDrawerReturn = {
  id: string;
  creditNoteNumber: string;
  creditNoteDate: string;
  outcome: string;
  totalAmount: number;
  refundedAmount: number;
  appliedAmount: number;
  usageStatus: string;
  refundMethod: string | null;
  lines: SalesRegisterDrawerReturnLine[];
};

const CREDIT_NOTE_FOR_RECEIPT_SELECT =
  "id, credit_note_number, credit_note_date, return_mode, status, total_amount, refunded_amount, applied_amount, credit_note_line_items(quantity, source_income_register_id, product:finished_products(product_code, product_name))";

const CREDIT_NOTE_DETAIL_SELECT =
  "id, credit_note_number, credit_note_date, return_mode, status, total_amount, refunded_amount, applied_amount, pos_invoice_no, reason, credit_note_line_items(quantity, source_income_register_id, product:finished_products(product_code, product_name))";

export const SALES_REGISTER_VIEW_ONLY_TOOLTIP =
  "Select a business to make changes";

export async function loadReceiptDrawerPayments(
  supabase: SupabaseClient,
  receipt: SalesRegisterReceiptRow,
): Promise<SalesRegisterDrawerPayment[]> {
  const lineIds = receipt.lines.map((line) => line.id);
  const payments: SalesRegisterDrawerPayment[] = [];

  for (const line of receipt.lines) {
    const received = Number(line.amount_received) || 0;
    if (received > 0 && !line.is_sale_return) {
      payments.push({
        key: `checkout-${line.id}`,
        label: getProductSaleProductLabel(line),
        amount: received,
        method: resolveStoredProductSalePaymentMethod(line),
        date: line.date,
      });
    }
  }

  if (lineIds.length === 0) {
    return payments;
  }

  const { data, error } = await supabase
    .from("product_sale_payments")
    .select(PRODUCT_SALE_PAYMENT_SELECT)
    .in("income_id", lineIds)
    .order("payment_date", { ascending: true });

  if (error) {
    return payments;
  }

  for (const row of (data as ProductSalePaymentRow[] | null) ?? []) {
    const line = receipt.lines.find((entry) => entry.id === row.income_id);
    payments.push({
      key: row.id,
      label: line ? getProductSaleProductLabel(line) : "Payment",
      amount: Number(row.amount) || 0,
      method: row.payment_method?.trim() || "—",
      date: row.payment_date,
    });
  }

  return payments;
}

export async function loadReceiptDrawerReturns(
  supabase: SupabaseClient,
  invoiceNo: string,
): Promise<SalesRegisterDrawerReturn[]> {
  const trimmed = invoiceNo.trim();
  if (!trimmed) {
    return [];
  }

  const { data: notes, error } = await supabase
    .from("credit_notes")
    .select(CREDIT_NOTE_FOR_RECEIPT_SELECT)
    .eq("pos_invoice_no", trimmed)
    .order("credit_note_date", { ascending: false });

  if (error || !notes) {
    return [];
  }

  const noteIds = notes.map((note) => String(note.id));
  const refundsByNote = await loadRefundsByCreditNoteIds(supabase, noteIds);

  return notes.map((note) => mapCreditNoteToDrawerReturn(note, refundsByNote));
}

export async function loadReturnRowDrawerDetail(
  supabase: SupabaseClient,
  creditNoteId: string | null,
): Promise<{
  creditNote: Record<string, unknown> | null;
  returns: SalesRegisterDrawerReturn[];
  linkedInvoiceNo: string | null;
  refunds: ReturnRefundSummary[];
}> {
  if (!creditNoteId) {
    return {
      creditNote: null,
      returns: [],
      linkedInvoiceNo: null,
      refunds: [],
    };
  }

  const { data: note, error } = await supabase
    .from("credit_notes")
    .select(CREDIT_NOTE_DETAIL_SELECT)
    .eq("id", creditNoteId)
    .maybeSingle();

  if (error || !note) {
    return {
      creditNote: null,
      returns: [],
      linkedInvoiceNo: null,
      refunds: [],
    };
  }

  const refunds = await loadRefundsByCreditNoteIds(supabase, [creditNoteId]);
  const refundList = refunds.get(creditNoteId) ?? [];

  return {
    creditNote: note as Record<string, unknown>,
    returns: [mapCreditNoteToDrawerReturn(note, refunds)],
    linkedInvoiceNo:
      typeof note.pos_invoice_no === "string" ? note.pos_invoice_no : null,
    refunds: refundList,
  };
}

export async function loadRefundsByCreditNoteIds(
  supabase: SupabaseClient,
  creditNoteIds: string[],
): Promise<Map<string, ReturnRefundSummary[]>> {
  const map = new Map<string, ReturnRefundSummary[]>();
  const ids = [...new Set(creditNoteIds.filter(Boolean))];
  if (ids.length === 0) {
    return map;
  }

  const { data } = await supabase
    .from("refunds")
    .select("credit_note_id, method, amount, refund_date")
    .in("credit_note_id", ids)
    .order("refund_date", { ascending: true });

  for (const row of data ?? []) {
    const noteId = String(row.credit_note_id ?? "");
    if (!noteId) {
      continue;
    }
    const bucket = map.get(noteId) ?? [];
    bucket.push({
      method: String(row.method ?? ""),
      amount: Number(row.amount) || 0,
      refund_date: String(row.refund_date ?? ""),
    });
    map.set(noteId, bucket);
  }

  return map;
}

function mapCreditNoteToDrawerReturn(
  note: {
    id: string;
    credit_note_number: string;
    credit_note_date: string;
    return_mode: string | null;
    total_amount: number;
    refunded_amount: number;
    applied_amount: number;
    credit_note_line_items?: unknown;
  },
  refundsByNote: Map<string, ReturnRefundSummary[]>,
): SalesRegisterDrawerReturn {
  const refunds = refundsByNote.get(String(note.id)) ?? [];
  const lineItems = normalizeLineItems(note.credit_note_line_items);

  return {
    id: String(note.id),
    creditNoteNumber: note.credit_note_number,
    creditNoteDate: note.credit_note_date,
    outcome: formatCreditNoteOutcomeLabel(note.return_mode),
    totalAmount: Number(note.total_amount) || 0,
    refundedAmount: Number(note.refunded_amount) || 0,
    appliedAmount: Number(note.applied_amount) || 0,
    usageStatus: formatCreditNoteUsageStatus({
      total_amount: Number(note.total_amount) || 0,
      refunded_amount: Number(note.refunded_amount) || 0,
      applied_amount: Number(note.applied_amount) || 0,
    }),
    refundMethod: refunds[0]?.method?.trim() || null,
    lines: lineItems,
  };
}

function normalizeLineItems(raw: unknown): SalesRegisterDrawerReturnLine[] {
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return rows.map((item) => {
    const row = item as {
      quantity?: number;
      product?: { product_code?: string; product_name?: string } | { product_code?: string; product_name?: string }[];
    };
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    const label = product?.product_name
      ? `${product.product_code ?? ""} — ${product.product_name}`.trim()
      : "Line";
    return {
      productLabel: label,
      quantity: Number(row.quantity) || 0,
    };
  });
}

export function formatDrawerPaymentSummary(payment: SalesRegisterDrawerPayment): string {
  return `${formatGHS(payment.amount)} via ${payment.method} on ${formatDate(payment.date)}`;
}

export function formatDrawerReturnSummary(ret: SalesRegisterDrawerReturn): string {
  const refunded =
    ret.refundedAmount > 0
      ? ` · Refunded ${formatGHS(ret.refundedAmount)}${ret.refundMethod ? ` (${ret.refundMethod})` : ""}`
      : "";
  const applied =
    ret.appliedAmount > 0 ? ` · Applied ${formatGHS(ret.appliedAmount)}` : "";
  return `${formatGHS(ret.totalAmount)}${refunded}${applied}`;
}
