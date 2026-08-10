import type { PostgrestError } from "@supabase/supabase-js";

/** FK constraints on public tables referencing customers(tenant_id, client_id). */
export const CUSTOMER_DELETE_FK_MESSAGES: Record<string, string> = {
  campaign_recipients_customer_fkey:
    "This customer appears on one or more email campaign recipient lists. Remove them from campaigns first.",
  client_invoices_tenant_id_client_id_fkey:
    "This customer has invoices. Void or reassign those invoices before deleting.",
  client_quotations_tenant_id_client_id_fkey:
    "This customer has quotations. Delete or reassign those quotations first.",
  complaint_register_client_id_fkey:
    "This customer has complaint register entries. Remove or reassign those records first.",
  corrective_actions_client_id_fkey:
    "This customer has corrective action records. Remove or reassign those records first.",
  credit_notes_client_fkey:
    "This customer has credit notes. Remove or reassign those records first.",
  crm_sales_customer_id_fkey:
    "This customer has CRM sales log entries. Void or remove those sales first.",
  crm_subscriptions_customer_id_fkey:
    "This customer has an active platform subscription and can't be deleted. Cancel or transfer the subscription first.",
  customer_comm_preferences_customer_fkey:
    "This customer has communication preferences on file. Remove those preferences first.",
  failed_inspections_client_id_fkey:
    "This customer has failed inspection records. Remove or reassign those records first.",
  incident_register_client_id_fkey:
    "This customer has incident register entries. Remove or reassign those records first.",
  income_register_client_id_fkey:
    "This customer has income register entries. Void or remove those entries first.",
  inspection_summary_client_id_fkey:
    "This customer has inspection summary records. Remove or reassign those records first.",
  loyalty_accounts_client_fkey:
    "This customer has a loyalty account. Close or transfer the account first.",
  roster_config_client_id_fkey:
    "This customer has roster configuration. Remove or reassign it first.",
  sales_activities_client_fkey:
    "This customer has sales activities. Remove or reassign those activities first.",
  sales_opportunities_client_fkey:
    "This customer has sales pipeline opportunities. Delete or reassign those opportunities first.",
  sales_quotes_client_fkey:
    "This customer has product quotes. Delete or reassign those quotes first.",
  sites_client_id_fkey:
    "This customer has sites assigned. Remove or reassign those sites first.",
  user_accounts_client_id_fkey:
    "This customer is linked to a portal user account. Unlink or reassign the account first.",
  work_orders_client_id_fkey:
    "This customer has work orders. Remove or reassign those work orders first.",
};

const FK_CONSTRAINT_NAME_PATTERN =
  /violates foreign key constraint "([^"]+)"/i;

export function extractForeignKeyConstraintName(
  message: string | null | undefined,
): string | null {
  if (!message) {
    return null;
  }

  const match = message.match(FK_CONSTRAINT_NAME_PATTERN);
  return match?.[1] ?? null;
}

export function isCustomerDeleteForeignKeyError(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): boolean {
  if (!error) {
    return false;
  }

  if (error.code === "23503") {
    return true;
  }

  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("violates foreign key constraint") &&
    message.includes("customers")
  );
}

export function getCustomerDeleteErrorMessage(
  error: Pick<PostgrestError, "code" | "message"> | null | undefined,
): string {
  if (!error?.message) {
    return "Unable to delete this customer. Try again.";
  }

  const constraintName =
    extractForeignKeyConstraintName(error.message) ??
    Object.keys(CUSTOMER_DELETE_FK_MESSAGES).find((name) =>
      error.message.includes(name),
    );

  if (constraintName && CUSTOMER_DELETE_FK_MESSAGES[constraintName]) {
    return CUSTOMER_DELETE_FK_MESSAGES[constraintName];
  }

  if (isCustomerDeleteForeignKeyError(error)) {
    return "This customer is linked to other records and can't be deleted. Remove or reassign those records first.";
  }

  return error.message;
}
