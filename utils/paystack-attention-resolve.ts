import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { type ManualSaleCartSnapshot } from "@/utils/manual-sale-paystack";
import {
  isMissingPaystackAttentionTable,
  PAYSTACK_ATTENTION_TABLE,
  type PaystackAttentionRow,
  type PaystackAttentionStatus,
} from "@/utils/paystack-payment-attention";
import { roundGhs } from "@/utils/product-sale-paystack";

const ATTENTION_SELECT =
  "id, tenant_id, payment_request_id, paystack_reference, amount, customer_label, client_id, reason, status, created_at";

export const PAYSTACK_ATTENTION_ACTIONS = ["store_credit", "refunded"] as const;

export type PaystackAttentionAction = (typeof PAYSTACK_ATTENTION_ACTIONS)[number];

export const PAYSTACK_ATTENTION_SALE_RETIRED =
  "This action is no longer available.";

/** Sale-with-backorder is retired. Store credit and refund stay. */
export function paystackAttentionActionRefusal(action: string | undefined): {
  status: 400;
  error: string;
} | null {
  if (action === "sale") {
    return { status: 400, error: PAYSTACK_ATTENTION_SALE_RETIRED };
  }
  if (action === "store_credit" || action === "refunded") {
    return null;
  }
  return { status: 400, error: "Choose a payment and a resolution." };
}

export type PaystackAttentionResolveResult =
  | { ok: true; message: string }
  | { ok: false; status: number; error: string };

function accraDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function storeCreditNumber(reference: string): string {
  const clean = reference.replace(/[^A-Za-z0-9]/g, "").slice(0, 40);
  return `PSC-${clean || "PAY"}`;
}

function asSnapshot(value: unknown): ManualSaleCartSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as ManualSaleCartSnapshot;
}

async function closeAttention(
  admin: SupabaseClient,
  row: PaystackAttentionRow,
  status: Exclude<PaystackAttentionStatus, "open">,
  resolvedBy: string,
  note: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from(PAYSTACK_ATTENTION_TABLE)
    .update({
      status,
      resolution_note: note,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("tenant_id", row.tenant_id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  if (error) {
    return error.message;
  }
  if (!data?.id) {
    return "This payment was already resolved.";
  }
  return null;
}

async function cancelRequest(
  admin: SupabaseClient,
  row: PaystackAttentionRow,
  note: string,
): Promise<string | null> {
  const { error } = await admin
    .from("product_sale_payment_requests")
    .update({
      status: "cancelled",
      email_error: note.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.payment_request_id)
    .eq("tenant_id", row.tenant_id);
  return error?.message ?? null;
}

export async function resolvePaystackAttention(
  admin: SupabaseClient,
  input: {
    tenantId: string;
    attentionId: string;
    action: string;
    resolvedBy: string;
  },
): Promise<PaystackAttentionResolveResult> {
  const refusal = paystackAttentionActionRefusal(input.action);
  if (refusal) {
    return { ok: false, status: refusal.status, error: refusal.error };
  }

  const loaded = await admin
    .from(PAYSTACK_ATTENTION_TABLE)
    .select(ATTENTION_SELECT)
    .eq("id", input.attentionId)
    .eq("tenant_id", input.tenantId)
    .maybeSingle();
  if (loaded.error) {
    if (isMissingPaystackAttentionTable(loaded.error)) {
      return {
        ok: false,
        status: 503,
        error:
          "Payments needing attention is not installed yet. Create the paystack_payment_attention table first.",
      };
    }
    return { ok: false, status: 500, error: loaded.error.message };
  }
  const row = loaded.data as PaystackAttentionRow | null;
  if (!row) {
    return { ok: false, status: 404, error: "That payment was not found." };
  }
  if (row.status !== "open") {
    return { ok: false, status: 409, error: "This payment was already resolved." };
  }

  if (input.action === "refunded") {
    const cancelError = await cancelRequest(
      admin,
      row,
      `Marked refunded. Refund done in Paystack. Ref ${row.paystack_reference}.`,
    );
    if (cancelError) {
      return { ok: false, status: 500, error: cancelError };
    }
    const closeError = await closeAttention(
      admin,
      row,
      "refunded",
      input.resolvedBy,
      "Refund done in Paystack.",
    );
    if (closeError) {
      return { ok: false, status: 500, error: closeError };
    }
    return { ok: true, message: "Marked refunded" };
  }

  if (input.action === "store_credit") {
    const clientId = row.client_id?.trim() || "";
    if (!clientId) {
      return {
        ok: false,
        status: 409,
        error: "Store credit needs a contract customer.",
      };
    }
    const number = storeCreditNumber(row.paystack_reference);
    const amount = roundGhs(Number(row.amount) || 0);
    const today = accraDate();
    const reason = `Paystack payment held as store credit. Ref ${row.paystack_reference}. ${row.reason}`;
    const requestRow = await admin
      .from("product_sale_payment_requests")
      .select("cart_snapshot")
      .eq("id", row.payment_request_id)
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();
    const snapshot = asSnapshot(requestRow.data?.cart_snapshot);
    const inserted = await admin
      .from("credit_notes")
      .insert({
        tenant_id: row.tenant_id,
        client_id: clientId,
        source_type: "product_sale",
        source_income_register_id: null,
        credit_note_number: number,
        credit_note_date: today,
        reason,
        business_unit_id: snapshot?.businessUnitId ?? null,
        return_mode: "store_credit",
        status: "issued",
        subtotal: amount,
        total_amount: amount,
        refunded_amount: 0,
        applied_amount: 0,
      })
      .select("id")
      .maybeSingle();
    let noteId = inserted.data?.id as string | undefined;
    if (inserted.error) {
      if (inserted.error.code !== "23505") {
        return { ok: false, status: 500, error: inserted.error.message };
      }
      const existing = await admin
        .from("credit_notes")
        .select("id")
        .eq("tenant_id", row.tenant_id)
        .eq("credit_note_number", number)
        .maybeSingle();
      noteId = existing.data?.id as string | undefined;
      if (!noteId) {
        return { ok: false, status: 500, error: inserted.error.message };
      }
    } else if (noteId) {
      const lineError = await admin.from("credit_note_line_items").insert({
        credit_note_id: noteId,
        tenant_id: row.tenant_id,
        product_id: null,
        description: `Paystack payment held as store credit (${row.paystack_reference})`,
        quantity: 1,
        unit_price: amount,
        total_amount: amount,
      });
      if (lineError.error) {
        return { ok: false, status: 500, error: lineError.error.message };
      }
    }
    const cancelError = await cancelRequest(
      admin,
      row,
      `Held as store credit ${number}. Ref ${row.paystack_reference}.`,
    );
    if (cancelError) {
      return { ok: false, status: 500, error: cancelError };
    }
    const closeError = await closeAttention(
      admin,
      row,
      "store_credit",
      input.resolvedBy,
      `Store credit ${number}.`,
    );
    if (closeError) {
      return { ok: false, status: 500, error: closeError };
    }
    return { ok: true, message: "Stored as customer credit" };
  }

  return {
    ok: false,
    status: 400,
    error: PAYSTACK_ATTENTION_SALE_RETIRED,
  };
}
