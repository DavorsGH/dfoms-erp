import type { TransactionalEventType } from "@/utils/transactional-notification-types";

export const CLIENT_DOCUMENT_NOTIFICATION_EVENTS = [
  "quotation_sent",
  "invoice_created",
  "receipt_issued",
] as const satisfies readonly TransactionalEventType[];

export type ClientDocumentNotificationEvent =
  (typeof CLIENT_DOCUMENT_NOTIFICATION_EVENTS)[number];

export type ClientDocumentTemplateSpec = {
  event_type: ClientDocumentNotificationEvent;
  name: string;
  subject: string;
  body_email: string;
  body_sms: string;
  variables: string[];
};

/** Shared ERP portal base URL for client-document email links. */
export function resolveClientPortalBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    "https://portal.davorsfacilities.com"
  ).replace(/\/$/, "");
}

export function buildClientDocumentPortalUrlVars(): Record<string, string> {
  const base = resolveClientPortalBaseUrl();
  return {
    portal_quotations_url: `${base}/dashboard/client-portal/quotations`,
    portal_invoices_url: `${base}/dashboard/client-portal/invoices`,
    portal_receipts_url: `${base}/dashboard/client-portal/receipts`,
  };
}

/** Tenant-agnostic transactional templates for client document notifications. */
export function buildClientDocumentTemplateSpecs(): ClientDocumentTemplateSpec[] {
  const portal = buildClientDocumentPortalUrlVars();

  return [
    {
      event_type: "quotation_sent",
      name: "Quotation Sent",
      subject: "Quotation {{quotation_number}} from {{tenant_name}}",
      body_email: `Dear {{customer_name}},

Your quotation {{quotation_number}} is attached.
Amount: {{amount}}
Valid until: {{valid_until}}

View your quotations: ${portal.portal_quotations_url}`,
      body_sms:
        "Quotation {{quotation_number}} sent. Amount {{amount}}. Valid until {{valid_until}}.",
      variables: [
        "tenant_name",
        "customer_name",
        "quotation_number",
        "amount",
        "valid_until",
        "portal_quotations_url",
      ],
    },
    {
      event_type: "invoice_created",
      name: "Invoice Created",
      subject: "Invoice {{invoice_number}} from {{tenant_name}}",
      body_email: `Dear {{customer_name}},

Your invoice {{invoice_number}} is attached.
Amount: {{amount}}
Due: {{due_date}}

View your invoices: ${portal.portal_invoices_url}`,
      body_sms:
        "Invoice {{invoice_number}} issued. Amount {{amount}}. Due {{due_date}}.",
      variables: [
        "tenant_name",
        "customer_name",
        "invoice_number",
        "amount",
        "due_date",
        "portal_invoices_url",
      ],
    },
    {
      event_type: "receipt_issued",
      name: "Receipt Issued",
      subject:
        "Receipt {{receipt_number}} for invoice {{invoice_number}} from {{tenant_name}}",
      body_email: `Dear {{customer_name}},

Your receipt {{receipt_number}} for invoice {{invoice_number}} is attached.
Amount: {{amount}}
Date: {{payment_date}}

View your receipts: ${portal.portal_receipts_url}`,
      body_sms:
        "Receipt {{receipt_number}} for invoice {{invoice_number}}. Amount {{amount}}.",
      variables: [
        "tenant_name",
        "customer_name",
        "receipt_number",
        "invoice_number",
        "amount",
        "payment_date",
        "portal_receipts_url",
      ],
    },
  ];
}
