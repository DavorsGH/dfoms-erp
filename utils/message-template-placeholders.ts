/**
 * Placeholder names actually produced by build*Variables helpers used with
 * substituteTemplatePlaceholders. Keep lists in sync with those builders.
 */

/** From buildLesseeVariables (utils/lessee-announcement-send.ts). */
export const LESSEE_TEMPLATE_PLACEHOLDERS = [
  "tenant_name",
  "lessee_name",
  "full_name",
  "lessee_id",
  "email",
  "phone",
  "property_name",
  "property",
  "unit_number",
  "unit",
  "lease_id",
] as const;

/** From buildEmployeeVariables (utils/employee-announcement-send.ts). */
export const EMPLOYEE_TEMPLATE_PLACEHOLDERS = [
  "employee_name",
  "full_name",
  "staff_id",
  "employee_id",
  "email",
  "phone",
  "position",
  "shift",
  "employment_type",
  "employment_status",
] as const;

/** From buildCustomerVariables (utils/campaign-send.ts). */
export const CUSTOMER_TEMPLATE_PLACEHOLDERS = [
  "customer_name",
  "client_name",
  "customer_id",
  "client_id",
  "email",
  "phone",
  "contact_person",
  "address",
  "customer_type",
  "status",
] as const;

/** From fireTransactionalNotification client-document events. */
export const CLIENT_DOCUMENT_TEMPLATE_PLACEHOLDERS = [
  "tenant_name",
  "customer_name",
  "quotation_number",
  "invoice_number",
  "receipt_number",
  "amount",
  "valid_until",
  "due_date",
  "payment_date",
  "portal_quotations_url",
  "portal_invoices_url",
  "portal_receipts_url",
] as const;

export type TemplatePlaceholderName =
  | (typeof LESSEE_TEMPLATE_PLACEHOLDERS)[number]
  | (typeof EMPLOYEE_TEMPLATE_PLACEHOLDERS)[number]
  | (typeof CUSTOMER_TEMPLATE_PLACEHOLDERS)[number]
  | (typeof CLIENT_DOCUMENT_TEMPLATE_PLACEHOLDERS)[number];

export function formatTemplatePlaceholder(name: string): string {
  return `{{${name}}}`;
}
