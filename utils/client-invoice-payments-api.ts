import type { SupabaseClient } from "@supabase/supabase-js";
import {
  toNumber,
  type ClientInvoiceHeaderRow,
} from "@/utils/client-invoices-types";
import {
  CLIENT_RECEIPT_HEADER_SELECT,
  type ClientReceiptHeaderRow,
  type RecordClientInvoicePaymentBody,
} from "@/utils/client-receipts-types";

type DbClient = SupabaseClient;

export type RecordClientInvoicePaymentOptions = {
  /** When false, skip receipt_issued customer notification. Default true. */
  notify?: boolean;
};

type RecordClientInvoicePaymentRpcResult = {
  payment?: { id: string };
  receipt?: ClientReceiptHeaderRow;
  invoice?: ClientInvoiceHeaderRow;
};

type VoidClientInvoicePaymentRpcResult = {
  invoice?: ClientInvoiceHeaderRow;
  voided_receipt_number?: string | null;
};

function mapReceiptRow(row: ClientReceiptHeaderRow): ClientReceiptHeaderRow {
  return {
    ...row,
    amount: toNumber(row.amount),
    receipt_sequence: toNumber(row.receipt_sequence),
  };
}

function mapInvoiceRow(row: ClientInvoiceHeaderRow): ClientInvoiceHeaderRow {
  return {
    ...row,
    subtotal: toNumber(row.subtotal),
    vat_nhil_getfund_rate: toNumber(row.vat_nhil_getfund_rate),
    tax_due: toNumber(row.tax_due),
    wht_rate: toNumber(row.wht_rate),
    wht_amount: toNumber(row.wht_amount),
    total_amount_due: toNumber(row.total_amount_due),
    amount_received: toNumber(row.amount_received),
    invoice_sequence: toNumber(row.invoice_sequence),
  };
}

export async function recordClientInvoicePayment(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
  body: RecordClientInvoicePaymentBody,
  recordedBy: string | null,
  options?: RecordClientInvoicePaymentOptions,
): Promise<{
  payment: { id: string } | null;
  receipt: ClientReceiptHeaderRow | null;
  invoice: ClientInvoiceHeaderRow | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("record_client_invoice_payment", {
    p_tenant_id: tenantId,
    p_invoice_id: invoiceId,
    p_payment_date: body.payment_date,
    p_amount: body.amount,
    p_payment_method: body.payment_method ?? null,
    p_notes: body.notes ?? null,
    p_recorded_by: recordedBy,
  });

  if (error) {
    return {
      payment: null,
      receipt: null,
      invoice: null,
      error: error.message,
    };
  }

  const result = (data ?? {}) as RecordClientInvoicePaymentRpcResult;
  const receipt = result.receipt ? mapReceiptRow(result.receipt) : null;
  const invoice = result.invoice ? mapInvoiceRow(result.invoice) : null;

  const shouldNotify = options?.notify !== false;
  if (shouldNotify && receipt && invoice) {
    void import("@/utils/client-document-notifications").then(
      ({ notifyClientReceiptIssued }) => {
        void notifyClientReceiptIssued({
          tenantId,
          clientId: invoice.client_id,
          receiptId: receipt.id,
          receiptNumber: receipt.receipt_number,
          invoiceNumber: invoice.invoice_number,
          customerName: invoice.bill_to_name?.trim() || invoice.client_id,
          amount: String(receipt.amount ?? ""),
          paymentDate: receipt.receipt_date ?? "",
          invoiceTotalDue: invoice.total_amount_due,
          whtRate: invoice.wht_rate,
          whtAmount: invoice.wht_amount,
        });
      },
    );
  }

  return {
    payment: result.payment ?? null,
    receipt,
    invoice,
    error: null,
  };
}

export async function voidClientInvoicePayment(
  supabase: DbClient,
  tenantId: string,
  paymentId: string,
): Promise<{
  invoice: ClientInvoiceHeaderRow | null;
  voidedReceiptNumber: string | null;
  error: string | null;
}> {
  const { data, error } = await supabase.rpc("void_client_invoice_payment", {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
  });

  if (error) {
    return { invoice: null, voidedReceiptNumber: null, error: error.message };
  }

  const result = (data ?? {}) as VoidClientInvoicePaymentRpcResult;

  return {
    invoice: result.invoice ? mapInvoiceRow(result.invoice) : null,
    voidedReceiptNumber: result.voided_receipt_number ?? null,
    error: null,
  };
}

export async function loadClientReceiptDetail(
  supabase: DbClient,
  tenantId: string,
  receiptId: string,
) {
  const { data: receipt, error: receiptError } = await supabase
    .from("client_receipts")
    .select(CLIENT_RECEIPT_HEADER_SELECT)
    .eq("id", receiptId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (receiptError) {
    return { receipt: null, invoice: null, error: receiptError.message };
  }

  if (!receipt) {
    return { receipt: null, invoice: null, error: "Receipt not found." };
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("client_invoices")
    .select(
      "invoice_number, bill_to_name, bill_to_address, bill_to_phone, total_amount_due, wht_rate, wht_amount, client_id",
    )
    .eq("id", receipt.invoice_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (invoiceError || !invoice) {
    return {
      receipt: null,
      invoice: null,
      error: invoiceError?.message ?? "Linked invoice not found.",
    };
  }

  return {
    receipt: {
      ...receipt,
      amount: toNumber(receipt.amount),
      receipt_sequence: toNumber(receipt.receipt_sequence),
    } as ClientReceiptHeaderRow,
    invoice: {
      ...invoice,
      total_amount_due: toNumber(invoice.total_amount_due),
      wht_rate: toNumber(invoice.wht_rate),
      wht_amount: toNumber(invoice.wht_amount),
    },
    error: null,
  };
}

export async function loadClientReceiptsForInvoice(
  supabase: DbClient,
  tenantId: string,
  invoiceId: string,
) {
  const { data, error } = await supabase
    .from("client_receipts")
    .select(CLIENT_RECEIPT_HEADER_SELECT)
    .eq("tenant_id", tenantId)
    .eq("invoice_id", invoiceId)
    .order("receipt_date", { ascending: false });

  if (error) {
    return { receipts: [], error: error.message };
  }

  return {
    receipts: (data ?? []).map((row) => ({
      ...row,
      amount: toNumber(row.amount),
      receipt_sequence: toNumber(row.receipt_sequence),
    })) as ClientReceiptHeaderRow[],
    error: null,
  };
}
