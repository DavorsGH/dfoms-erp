import "server-only";

import type { ResendEmailAttachment } from "@/utils/resend-email";
import { createAdminClient } from "@/utils/supabase/admin";
import { insertClientPortalNotification } from "@/utils/client-portal-notifications";
import { renderClientInvoicePdfBuffer } from "@/utils/client-invoice-pdf-server";
import { renderClientQuotationPdfBuffer } from "@/utils/client-quotation-pdf-server";
import { renderClientReceiptPdfBuffer } from "@/utils/client-receipt-pdf-server";
import { formatReceiptAmountSectionForEmail } from "@/app/dashboard/finance/client-receipts/client-receipt-display-utils";
import { toNumber } from "@/utils/client-invoices-types";
import { fireTransactionalNotification } from "@/utils/transactional-notification-trigger";
import type { TransactionalEventType } from "@/utils/transactional-notification-types";

type ClientDocumentEventType =
  | "invoice_created"
  | "quotation_sent"
  | "receipt_issued"
  | "contract_raised";

type NotifyClientDocumentOptions = {
  tenantId: string;
  clientId: string;
  eventType: ClientDocumentEventType;
  variables: Record<string, string>;
  documentId: string;
  inbox: {
    title: string;
    body: string;
    actionUrl: string;
  };
  attachmentFilename: string;
  context: string;
  businessUnitId?: string | null;
};

async function renderDocumentPdfAttachment(
  tenantId: string,
  eventType: ClientDocumentEventType,
  documentId: string,
  attachmentFilename: string,
): Promise<ResendEmailAttachment | null> {
  const admin = createAdminClient();

  if (eventType === "invoice_created") {
    const rendered = await renderClientInvoicePdfBuffer({
      supabase: admin,
      tenantId,
      invoiceId: documentId,
    });
    if (!rendered.ok) {
      console.error(
        `[client-document-notifications] invoice PDF failed (${documentId}):`,
        rendered.error,
      );
      return null;
    }
    return {
      filename: attachmentFilename || `${rendered.invoiceNumber}.pdf`,
      content: rendered.buffer,
      contentType: "application/pdf",
    };
  }

  if (eventType === "quotation_sent") {
    const rendered = await renderClientQuotationPdfBuffer({
      supabase: admin,
      tenantId,
      quotationId: documentId,
    });
    if (!rendered.ok) {
      console.error(
        `[client-document-notifications] quotation PDF failed (${documentId}):`,
        rendered.error,
      );
      return null;
    }
    return {
      filename: attachmentFilename || `${rendered.quotationNumber}.pdf`,
      content: rendered.buffer,
      contentType: "application/pdf",
    };
  }

  const rendered = await renderClientReceiptPdfBuffer({
    supabase: admin,
    tenantId,
    receiptId: documentId,
  });
  if (!rendered.ok) {
    console.error(
      `[client-document-notifications] receipt PDF failed (${documentId}):`,
      rendered.error,
    );
    return null;
  }
  return {
    filename: attachmentFilename || `${rendered.receiptNumber}.pdf`,
    content: rendered.buffer,
    contentType: "application/pdf",
  };
}

async function resolveDocumentBusinessUnitId(
  tenantId: string,
  eventType: ClientDocumentEventType,
  documentId: string,
): Promise<string | null> {
  const admin = createAdminClient();

  if (eventType === "invoice_created") {
    const { data } = await admin
      .from("client_invoices")
      .select("business_unit_id")
      .eq("tenant_id", tenantId)
      .eq("id", documentId)
      .maybeSingle();
    return (data?.business_unit_id as string | null | undefined)?.trim() || null;
  }

  if (eventType === "quotation_sent") {
    const { data } = await admin
      .from("client_quotations")
      .select("business_unit_id")
      .eq("tenant_id", tenantId)
      .eq("id", documentId)
      .maybeSingle();
    return (data?.business_unit_id as string | null | undefined)?.trim() || null;
  }

  if (eventType === "receipt_issued") {
    const { data } = await admin
      .from("client_receipts")
      .select("business_unit_id")
      .eq("tenant_id", tenantId)
      .eq("id", documentId)
      .maybeSingle();
    return (data?.business_unit_id as string | null | undefined)?.trim() || null;
  }

  return null;
}

/**
 * Best-effort customer document notification: in-app inbox + optional email/SMS
 * via transactional rules. Email includes the rendered PDF when available.
 */
export async function notifyClientDocumentEvent(
  options: NotifyClientDocumentOptions,
): Promise<void> {
  try {
    void insertClientPortalNotification({
      tenantId: options.tenantId,
      clientId: options.clientId,
      title: options.inbox.title,
      body: options.inbox.body,
      actionUrl: options.inbox.actionUrl,
      context: options.context,
    });

    const attachment = await renderDocumentPdfAttachment(
      options.tenantId,
      options.eventType,
      options.documentId,
      options.attachmentFilename,
    );

    const businessUnitId =
      options.businessUnitId !== undefined
        ? options.businessUnitId
        : await resolveDocumentBusinessUnitId(
            options.tenantId,
            options.eventType,
            options.documentId,
          );

    await fireTransactionalNotification(
      options.tenantId,
      options.eventType as TransactionalEventType,
      options.clientId,
      options.variables,
      {
        emailAttachments: attachment ? [attachment] : undefined,
        businessUnitId,
      },
    );
  } catch (error) {
    console.error(
      `[client-document-notifications] failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function notifyClientInvoiceSent(options: {
  tenantId: string;
  clientId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amount: string;
  dueDate: string;
}): Promise<void> {
  await notifyClientDocumentEvent({
    tenantId: options.tenantId,
    clientId: options.clientId,
    eventType: "invoice_created",
    documentId: options.invoiceId,
    attachmentFilename: `${options.invoiceNumber}.pdf`,
    variables: {
      customer_name: options.customerName,
      invoice_number: options.invoiceNumber,
      amount: options.amount,
      due_date: options.dueDate,
    },
    inbox: {
      title: `Invoice ${options.invoiceNumber}`,
      body: "Your invoice is ready to view in the customer portal.",
      actionUrl: "/dashboard/client-portal/invoices",
    },
    context: `invoice_sent/${options.invoiceId}`,
  });
}

/** @deprecated Use notifyClientInvoiceSent — customer notifications fire on Send, not create. */
export async function notifyClientInvoiceCreated(options: {
  tenantId: string;
  clientId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amount: string;
  dueDate: string;
}): Promise<void> {
  await notifyClientInvoiceSent(options);
}

export async function notifyClientQuotationSent(options: {
  tenantId: string;
  clientId: string;
  quotationId: string;
  quotationNumber: string;
  customerName: string;
  amount: string;
  validUntil: string;
}): Promise<void> {
  await notifyClientDocumentEvent({
    tenantId: options.tenantId,
    clientId: options.clientId,
    eventType: "quotation_sent",
    documentId: options.quotationId,
    attachmentFilename: `${options.quotationNumber}.pdf`,
    variables: {
      customer_name: options.customerName,
      quotation_number: options.quotationNumber,
      amount: options.amount,
      valid_until: options.validUntil,
    },
    inbox: {
      title: `Quotation ${options.quotationNumber}`,
      body: "Your quotation is ready to view in the customer portal.",
      actionUrl: `/dashboard/client-portal/quotations/${options.quotationId}`,
    },
    context: `quotation_sent/${options.quotationId}`,
  });
}

export async function notifyClientReceiptIssued(options: {
  tenantId: string;
  clientId: string;
  receiptId: string;
  receiptNumber: string;
  invoiceNumber: string;
  customerName: string;
  amount: string;
  paymentDate: string;
  /** Optional — when omitted, loaded from the receipt's invoice for WHT breakdown. */
  invoiceTotalDue?: number | string;
  whtRate?: number | string;
  whtAmount?: number | string;
}): Promise<void> {
  const amountSection = await resolveReceiptIssuedAmountSection(options);

  await notifyClientDocumentEvent({
    tenantId: options.tenantId,
    clientId: options.clientId,
    eventType: "receipt_issued",
    documentId: options.receiptId,
    attachmentFilename: `${options.receiptNumber}.pdf`,
    variables: {
      customer_name: options.customerName,
      receipt_number: options.receiptNumber,
      invoice_number: options.invoiceNumber,
      amount: options.amount,
      amount_section: amountSection,
      payment_date: options.paymentDate,
    },
    inbox: {
      title: `Receipt ${options.receiptNumber}`,
      body: `Payment receipt for invoice ${options.invoiceNumber} is ready to view.`,
      actionUrl: `/dashboard/client-portal/receipts/${options.receiptId}`,
    },
    context: `receipt_issued/${options.receiptId}`,
  });
}

async function resolveReceiptIssuedAmountSection(options: {
  tenantId: string;
  receiptId: string;
  amount: string;
  invoiceTotalDue?: number | string;
  whtRate?: number | string;
  whtAmount?: number | string;
}): Promise<string> {
  let invoice = {
    total_amount_due: toNumber(options.invoiceTotalDue),
    wht_rate: toNumber(options.whtRate),
    wht_amount: toNumber(options.whtAmount),
  };

  const needsLookup =
    options.invoiceTotalDue == null || options.whtAmount == null;

  if (needsLookup) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("client_receipts")
      .select(
        "amount, invoice:client_invoices!client_receipts_invoice_id_fkey(total_amount_due, wht_rate, wht_amount)",
      )
      .eq("tenant_id", options.tenantId)
      .eq("id", options.receiptId)
      .maybeSingle();

    if (error) {
      console.error(
        `[client-document-notifications] receipt amount lookup failed (${options.receiptId}):`,
        error.message,
      );
    } else {
      const linked = data?.invoice;
      const inv = Array.isArray(linked) ? linked[0] : linked;
      if (inv) {
        invoice = {
          total_amount_due: toNumber(inv.total_amount_due),
          wht_rate: toNumber(inv.wht_rate),
          wht_amount: toNumber(inv.wht_amount),
        };
      }
    }
  }

  return formatReceiptAmountSectionForEmail(invoice, options.amount);
}

export async function notifyClientContractRaised(options: {
  tenantId: string;
  clientId: string;
  contractId: string;
  contractNumber: string;
  quotationNumber: string;
  customerName: string;
}): Promise<void> {
  try {
    void insertClientPortalNotification({
      tenantId: options.tenantId,
      clientId: options.clientId,
      title: `Service contract ${options.contractNumber}`,
      body: `Your service contract has been raised from quotation ${options.quotationNumber}.`,
      actionUrl: "/dashboard/client-portal/invoices",
      context: `contract_raised/${options.contractId}`,
    });

    await fireTransactionalNotification(
      options.tenantId,
      "contract_raised",
      options.clientId,
      {
        customer_name: options.customerName,
        contract_number: options.contractNumber,
        quotation_number: options.quotationNumber,
      },
      { emailOnly: true },
    );
  } catch (error) {
    console.error(
      `[client-document-notifications] contract_raised failed (${options.contractId}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

export function shouldFireQuotationSentNotification(
  previousStatus: string | null | undefined,
  nextStatus: string | null | undefined,
): boolean {
  const next = (nextStatus ?? "").trim().toLowerCase();
  if (next !== "sent") {
    return false;
  }
  const previous = (previousStatus ?? "").trim().toLowerCase();
  return previous !== "sent";
}

/** First transition to sent only — same guard as quotations. */
export const shouldFireInvoiceSentNotification = shouldFireQuotationSentNotification;
