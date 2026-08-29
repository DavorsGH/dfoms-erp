import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeClientInvoiceCashOutstanding,
  deriveClientInvoiceStatusFromPayments,
} from "@/utils/client-invoice-payment-utils";
import {
  CLIENT_INVOICE_HEADER_SELECT,
  roundMoney,
  toNumber,
  type ClientInvoiceHeaderRow,
} from "@/utils/client-invoices-types";
import { sumClientInvoicePayments, syncIncomeRegisterFromClientInvoice } from "@/utils/client-invoices-api";
import {
  CLIENT_RECEIPT_HEADER_SELECT,
  type ClientReceiptHeaderRow,
  type RecordClientInvoicePaymentBody,
} from "@/utils/client-receipts-types";

type DbClient = SupabaseClient;

function nullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

async function allocateReceiptNumber(supabase: DbClient, tenantId: string) {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: "RCPT",
    p_padding: 4,
  });

  if (error) {
    return { receiptNumber: null, error: error.message };
  }

  const receiptNumber = typeof data === "string" ? data.trim() : "";
  if (!receiptNumber) {
    return {
      receiptNumber: null,
      error: "generate_next_code returned an empty receipt number.",
    };
  }

  return { receiptNumber, error: null };
}

async function getNextReceiptSequence(supabase: DbClient, tenantId: string) {
  const { data, error } = await supabase
    .from("client_receipts")
    .select("receipt_sequence")
    .eq("tenant_id", tenantId)
    .order("receipt_sequence", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { sequence: 1, error: error.message };
  }

  return {
    sequence: (data?.receipt_sequence ?? 0) + 1,
    error: null,
  };
}

type TenantSignatureDefaults = {
  signature_author_name: string | null;
  signature_author_title: string | null;
};

async function loadTenantSignatureDefaults(
  supabase: DbClient,
  tenantId: string,
): Promise<{ defaults: TenantSignatureDefaults; error: string | null }> {
  const { data, error } = await supabase
    .from("tenants")
    .select("signature_author_name, signature_author_title")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    return { defaults: { signature_author_name: null, signature_author_title: null }, error: error.message };
  }

  return {
    defaults: {
      signature_author_name: nullableText(data?.signature_author_name ?? null),
      signature_author_title: nullableText(data?.signature_author_title ?? null),
    },
    error: null,
  };
}

export async function recomputeClientInvoiceFromPayments(
  supabase: DbClient,
  tenantId: string,
  invoice: ClientInvoiceHeaderRow,
): Promise<{ invoice: ClientInvoiceHeaderRow | null; error: string | null }> {
  const { total, error: sumError } = await sumClientInvoicePayments(
    supabase,
    tenantId,
    invoice.id,
  );

  if (sumError) {
    return { invoice: null, error: sumError };
  }

  const totalDue = toNumber(invoice.total_amount_due);
  const whtAmount = toNumber(invoice.wht_amount);
  const nextStatus = deriveClientInvoiceStatusFromPayments(
    total,
    totalDue,
    whtAmount,
    invoice.status as ClientInvoiceHeaderRow["status"],
  );

  const { data: updated, error: updateError } = await supabase
    .from("client_invoices")
    .update({
      amount_received: total,
      status: nextStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", invoice.id)
    .eq("tenant_id", tenantId)
    .select(CLIENT_INVOICE_HEADER_SELECT)
    .single();

  if (updateError || !updated) {
    return { invoice: null, error: updateError?.message ?? "Unable to update invoice." };
  }

  const syncResult = await syncIncomeRegisterFromClientInvoice(
    supabase,
    tenantId,
    updated as ClientInvoiceHeaderRow,
  );

  if (syncResult.error) {
    return {
      invoice: updated as ClientInvoiceHeaderRow,
      error: syncResult.error,
    };
  }

  return { invoice: updated as ClientInvoiceHeaderRow, error: null };
}

export type RecordClientInvoicePaymentOptions = {
  /** When false, skip receipt_issued customer notification. Default true. */
  notify?: boolean;
};

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
  const { data: invoice, error: invoiceError } = await supabase
    .from("client_invoices")
    .select(CLIENT_INVOICE_HEADER_SELECT)
    .eq("id", invoiceId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (invoiceError) {
    return { payment: null, receipt: null, invoice: null, error: invoiceError.message };
  }

  if (!invoice) {
    return { payment: null, receipt: null, invoice: null, error: "Invoice not found." };
  }

  if (invoice.status === "draft") {
    return {
      payment: null,
      receipt: null,
      invoice: null,
      error: "Cannot record payment against a draft invoice. Mark it as sent first.",
    };
  }

  const amount = roundMoney(toNumber(body.amount));
  const { total: alreadyPaid, error: sumError } = await sumClientInvoicePayments(
    supabase,
    tenantId,
    invoiceId,
  );

  if (sumError) {
    return { payment: null, receipt: null, invoice: null, error: sumError };
  }

  const totalDue = toNumber(invoice.total_amount_due);
  const whtAmount = toNumber(invoice.wht_amount);
  const remaining = computeClientInvoiceCashOutstanding(
    totalDue,
    whtAmount,
    alreadyPaid,
  );
  if (amount > remaining + 0.009) {
    return {
      payment: null,
      receipt: null,
      invoice: null,
      error: `Payment amount exceeds outstanding balance (${remaining.toFixed(2)}).`,
    };
  }

  const { data: payment, error: paymentError } = await supabase
    .from("client_invoice_payments")
    .insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      payment_date: body.payment_date,
      amount,
      payment_method: nullableText(body.payment_method ?? null),
      notes: nullableText(body.notes ?? null),
      recorded_by: recordedBy,
    })
    .select("id")
    .single();

  if (paymentError || !payment) {
    return {
      payment: null,
      receipt: null,
      invoice: null,
      error: paymentError?.message ?? "Unable to record payment.",
    };
  }

  const { receiptNumber, error: receiptNumberError } = await allocateReceiptNumber(
    supabase,
    tenantId,
  );

  if (receiptNumberError || !receiptNumber) {
    await supabase
      .from("client_invoice_payments")
      .delete()
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return {
      payment: null,
      receipt: null,
      invoice: null,
      error: receiptNumberError ?? "Unable to allocate receipt number.",
    };
  }

  const { sequence, error: sequenceError } = await getNextReceiptSequence(
    supabase,
    tenantId,
  );

  if (sequenceError) {
    await supabase
      .from("client_invoice_payments")
      .delete()
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return { payment: null, receipt: null, invoice: null, error: sequenceError };
  }

  const { defaults, error: defaultsError } = await loadTenantSignatureDefaults(
    supabase,
    tenantId,
  );

  if (defaultsError) {
    await supabase
      .from("client_invoice_payments")
      .delete()
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return { payment: null, receipt: null, invoice: null, error: defaultsError };
  }

  const { data: receipt, error: receiptError } = await supabase
    .from("client_receipts")
    .insert({
      tenant_id: tenantId,
      invoice_id: invoiceId,
      payment_id: payment.id,
      receipt_number: receiptNumber,
      receipt_sequence: sequence,
      receipt_date: body.payment_date,
      amount,
      payment_method: nullableText(body.payment_method ?? null),
      notes: nullableText(body.notes ?? null),
      authorized_by_name: defaults.signature_author_name,
      authorized_by_title: defaults.signature_author_title,
    })
    .select(CLIENT_RECEIPT_HEADER_SELECT)
    .single();

  if (receiptError || !receipt) {
    await supabase
      .from("client_invoice_payments")
      .delete()
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return {
      payment: null,
      receipt: null,
      invoice: null,
      error: receiptError?.message ?? "Unable to create receipt.",
    };
  }

  const recompute = await recomputeClientInvoiceFromPayments(
    supabase,
    tenantId,
    invoice as ClientInvoiceHeaderRow,
  );

  if (recompute.error || !recompute.invoice) {
    return {
      payment: { id: payment.id },
      receipt: receipt as ClientReceiptHeaderRow,
      invoice: null,
      error: recompute.error ?? "Payment recorded but invoice totals could not be updated.",
    };
  }

  const shouldNotify = options?.notify !== false;
  if (shouldNotify) {
    void import("@/utils/client-document-notifications").then(
      ({ notifyClientReceiptIssued }) => {
        void notifyClientReceiptIssued({
          tenantId,
          clientId: recompute.invoice!.client_id,
          receiptId: (receipt as ClientReceiptHeaderRow).id,
          receiptNumber: (receipt as ClientReceiptHeaderRow).receipt_number,
          invoiceNumber: recompute.invoice!.invoice_number,
          customerName:
            recompute.invoice!.bill_to_name?.trim() || recompute.invoice!.client_id,
          amount: String((receipt as ClientReceiptHeaderRow).amount ?? ""),
          paymentDate: (receipt as ClientReceiptHeaderRow).receipt_date ?? "",
          invoiceTotalDue: recompute.invoice!.total_amount_due,
          whtRate: recompute.invoice!.wht_rate,
          whtAmount: recompute.invoice!.wht_amount,
        });
      },
    );
  }

  return {
    payment: { id: payment.id },
    receipt: receipt as ClientReceiptHeaderRow,
    invoice: recompute.invoice,
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
  const { data: payment, error: paymentError } = await supabase
    .from("client_invoice_payments")
    .select("id, invoice_id")
    .eq("id", paymentId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (paymentError) {
    return { invoice: null, voidedReceiptNumber: null, error: paymentError.message };
  }

  if (!payment) {
    return { invoice: null, voidedReceiptNumber: null, error: "Payment not found." };
  }

  const { data: receipt, error: receiptError } = await supabase
    .from("client_receipts")
    .select("receipt_number")
    .eq("payment_id", payment.id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (receiptError) {
    return { invoice: null, voidedReceiptNumber: null, error: receiptError.message };
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("client_invoices")
    .select(CLIENT_INVOICE_HEADER_SELECT)
    .eq("id", payment.invoice_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (invoiceError || !invoice) {
    return {
      invoice: null,
      voidedReceiptNumber: null,
      error: invoiceError?.message ?? "Linked invoice not found.",
    };
  }

  const { error: deleteError } = await supabase
    .from("client_invoice_payments")
    .delete()
    .eq("id", payment.id)
    .eq("tenant_id", tenantId);

  if (deleteError) {
    return { invoice: null, voidedReceiptNumber: null, error: deleteError.message };
  }

  const recompute = await recomputeClientInvoiceFromPayments(
    supabase,
    tenantId,
    invoice as ClientInvoiceHeaderRow,
  );

  if (recompute.error || !recompute.invoice) {
    return {
      invoice: recompute.invoice,
      voidedReceiptNumber: receipt?.receipt_number ?? null,
      error: recompute.error ?? "Payment voided but invoice totals could not be updated.",
    };
  }

  return {
    invoice: recompute.invoice,
    voidedReceiptNumber: receipt?.receipt_number ?? null,
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
