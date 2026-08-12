import "server-only";

import type { ResendEmailAttachment } from "@/utils/resend-email";
import { createAdminClient } from "@/utils/supabase/admin";
import { insertClientPortalNotification } from "@/utils/client-portal-notifications";
import { renderClientInvoicePdfBuffer } from "@/utils/client-invoice-pdf-server";
import { renderClientQuotationPdfBuffer } from "@/utils/client-quotation-pdf-server";
import { renderClientReceiptPdfBuffer } from "@/utils/client-receipt-pdf-server";
import { fireTransactionalNotification } from "@/utils/transactional-notification-trigger";
import type { TransactionalEventType } from "@/utils/transactional-notification-types";

type ClientDocumentEventType =
  | "invoice_created"
  | "quotation_sent"
  | "receipt_issued";

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

    await fireTransactionalNotification(
      options.tenantId,
      options.eventType as TransactionalEventType,
      options.clientId,
      options.variables,
      {
        emailAttachments: attachment ? [attachment] : undefined,
      },
    );
  } catch (error) {
    console.error(
      `[client-document-notifications] failed (${options.context}):`,
      error instanceof Error ? error.message : error,
    );
  }
}

export async function notifyClientInvoiceCreated(options: {
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
    context: `invoice_created/${options.invoiceId}`,
  });
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
}): Promise<void> {
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
