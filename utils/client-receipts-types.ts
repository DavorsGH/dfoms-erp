import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { formatGeneratedInvoiceNumber, formatInvoiceDate, toNumber } from "@/utils/client-invoices-types";

export const CLIENT_RECEIPT_LIST_SELECT =
  "id, tenant_id, invoice_id, payment_id, receipt_number, receipt_sequence, receipt_date, amount, payment_method, notes, authorized_by_name, authorized_by_title, created_at, invoice:client_invoices!client_receipts_invoice_id_fkey(invoice_number, bill_to_name, client_id)" as const;

export const CLIENT_RECEIPT_HEADER_SELECT =
  "id, tenant_id, invoice_id, payment_id, receipt_number, receipt_sequence, receipt_date, amount, payment_method, notes, authorized_by_name, authorized_by_title, created_at" as const;

export type ClientReceiptListRow = {
  id: string;
  tenant_id: string;
  invoice_id: string;
  payment_id: string;
  receipt_number: string;
  receipt_sequence: number;
  receipt_date: string;
  amount: number;
  payment_method: string | null;
  notes: string | null;
  authorized_by_name: string | null;
  authorized_by_title: string | null;
  created_at: string;
  invoice:
    | {
        invoice_number: string;
        bill_to_name: string;
        client_id: string;
      }
    | {
        invoice_number: string;
        bill_to_name: string;
        client_id: string;
      }[]
    | null;
};

export type ClientReceiptHeaderRow = {
  id: string;
  tenant_id: string;
  invoice_id: string;
  payment_id: string;
  receipt_number: string;
  receipt_sequence: number;
  receipt_date: string;
  amount: number;
  payment_method: string | null;
  notes: string | null;
  authorized_by_name: string | null;
  authorized_by_title: string | null;
  created_at: string;
};

export type ClientReceiptDetailPayload = {
  receipt: ClientReceiptHeaderRow;
  invoice: {
    invoice_number: string;
    bill_to_name: string;
    bill_to_address: string | null;
    bill_to_phone: string | null;
    total_amount_due: number;
    client_id: string;
  };
};

export type RecordClientInvoicePaymentBody = {
  payment_date: string;
  amount: number;
  payment_method?: string | null;
  notes?: string | null;
};

export function normalizeClientReceiptListRow(row: ClientReceiptListRow): ClientReceiptListRow {
  const invoiceRaw = row.invoice;
  const invoice = Array.isArray(invoiceRaw) ? (invoiceRaw[0] ?? null) : invoiceRaw;

  return {
    ...row,
    amount: toNumber(row.amount),
    receipt_sequence: toNumber(row.receipt_sequence),
    invoice,
  };
}

export function receiptInvoiceSummary(
  invoice: ClientReceiptListRow["invoice"],
): { invoice_number: string; bill_to_name: string } | null {
  if (!invoice) {
    return null;
  }

  return Array.isArray(invoice) ? (invoice[0] ?? null) : invoice;
}

export function formatReceiptMoney(amount: number) {
  return formatGHS(amount);
}

export { formatInvoiceDate, formatGeneratedInvoiceNumber };

export function validateRecordPaymentBody(body: RecordClientInvoicePaymentBody): string | null {
  if (!body.payment_date?.trim()) {
    return "Payment date is required.";
  }

  const amount = toNumber(body.amount);
  if (amount <= 0) {
    return "Payment amount must be greater than zero.";
  }

  return null;
}

export function hasReceiptAuthorizedBy(
  receipt: Pick<ClientReceiptHeaderRow, "authorized_by_name">,
) {
  return Boolean(receipt.authorized_by_name?.trim());
}

export function shouldShowReceiptSignatureBlock(options: {
  receipt: Pick<ClientReceiptHeaderRow, "authorized_by_name">;
  signatureImageUrl?: string | null;
}) {
  return hasReceiptAuthorizedBy(options.receipt) || Boolean(options.signatureImageUrl?.trim());
}
