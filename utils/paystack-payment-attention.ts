import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { insertEmployeeInAppNotifications } from "@/utils/employee-in-app-notifications";
import { PAYSTACK_ATTENTION_RESOLVE_ROLES } from "@/utils/rbac-access";
import { roundGhs } from "@/utils/product-sale-paystack";

export const PAYSTACK_ATTENTION_TABLE = "paystack_payment_attention";

export type PaystackAttentionStatus =
  | "open"
  | "recorded_sale"
  | "store_credit"
  | "refunded";

export type PaystackAttentionRow = {
  id: string;
  tenant_id: string;
  payment_request_id: string;
  paystack_reference: string;
  amount: number;
  customer_label: string | null;
  client_id: string | null;
  reason: string;
  status: PaystackAttentionStatus;
  created_at: string;
};

const ATTENTION_SELECT =
  "id, tenant_id, payment_request_id, paystack_reference, amount, customer_label, client_id, reason, status, created_at";

export class PaystackPaymentNeedsAttentionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaystackPaymentNeedsAttentionError";
  }
}

export function paystackAttentionMessage(input: {
  amount: number;
  reference: string;
  customer: string;
  reason: string;
  stored: boolean;
}): string {
  const who = input.customer.trim() || "the customer";
  const stored = input.stored
    ? "It is in Payments needing attention."
    : "The attention list is not installed yet. Keep this Paystack reference.";
  return `Paystack confirmed GHS ${input.amount.toFixed(2)} from ${who} (ref ${input.reference}). The sale was not recorded: ${input.reason} ${stored}`;
}

export function isMissingPaystackAttentionTable(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = (error.code ?? "").trim();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    (message.includes(PAYSTACK_ATTENTION_TABLE) &&
      (message.includes("does not exist") ||
        message.includes("schema cache") ||
        message.includes("could not find")))
  );
}

async function notifyAttention(
  admin: SupabaseClient,
  row: {
    tenant_id: string;
    amount: number;
    customer_label: string | null;
    paystack_reference: string;
    reason: string;
  },
): Promise<void> {
  const { data, error } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("tenant_id", row.tenant_id)
    .eq("is_active", true)
    .in("role", [...PAYSTACK_ATTENTION_RESOLVE_ROLES]);
  if (error || !data?.length) {
    return;
  }
  const customer = row.customer_label?.trim() || "A customer";
  await insertEmployeeInAppNotifications({
    context: "paystack-payment-attention",
    supabase: admin,
    rows: data
      .map((account) => String(account.auth_uid ?? "").trim())
      .filter(Boolean)
      .map((recipientUserId) => ({
        tenant_id: row.tenant_id,
        recipient_user_id: recipientUserId,
        title: "Paystack payment needs attention",
        body: `${customer} paid GHS ${row.amount.toFixed(2)} (ref ${row.paystack_reference}). The sale was not recorded. ${row.reason}`,
        action_url: "/dashboard/crm/sales",
      })),
  });
}

export async function recordPaystackPaymentAttention(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    paymentRequestId: string;
    reference: string;
    amount: number;
    customerLabel: string | null;
    clientId: string | null;
    reason: string;
  },
): Promise<{ stored: boolean; created: boolean }> {
  const reference = input.reference.trim();
  const amount = roundGhs(input.amount);
  if (!reference || amount <= 0) {
    return { stored: false, created: false };
  }
  const insert = await admin
    .from(PAYSTACK_ATTENTION_TABLE)
    .insert({
      tenant_id: input.tenantId,
      payment_request_id: input.paymentRequestId,
      paystack_reference: reference,
      amount,
      customer_label: input.customerLabel?.trim() || null,
      client_id: input.clientId?.trim() || null,
      reason: input.reason.trim() || "The sale could not be recorded.",
      status: "open",
    })
    .select(ATTENTION_SELECT)
    .maybeSingle();

  if (!insert.error && insert.data) {
    await notifyAttention(admin, {
      tenant_id: input.tenantId,
      amount,
      customer_label: input.customerLabel,
      paystack_reference: reference,
      reason: input.reason,
    });
    return { stored: true, created: true };
  }

  if (insert.error && isMissingPaystackAttentionTable(insert.error)) {
    return { stored: false, created: false };
  }

  const existing = await admin
    .from(PAYSTACK_ATTENTION_TABLE)
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (existing.error) {
    if (isMissingPaystackAttentionTable(existing.error)) {
      return { stored: false, created: false };
    }
    return { stored: false, created: false };
  }
  return { stored: Boolean(existing.data?.id), created: false };
}
