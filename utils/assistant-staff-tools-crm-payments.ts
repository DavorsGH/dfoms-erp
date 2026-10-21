import "server-only";

import {
  canCollectPaystackPayments,
  canViewPaystackAttentionList,
  formatPaystackPaymentAge,
  mobileMoneyStatusAccessError,
  paystackPaymentsPendingAccessError,
} from "@/utils/assistant-staff-r55-helpers";
import {
  LIST_LIMIT,
  STAFF_DATA_UNAVAILABLE_MESSAGE,
  getStaffSupabase,
  requireStaffSession,
} from "@/utils/assistant-staff-tool-common";
import { loadStaffBusinessUnitScope } from "@/utils/assistant-staff-tools-hr-common";
import {
  isMissingPaystackAttentionTable,
  PAYSTACK_ATTENTION_TABLE,
} from "@/utils/paystack-payment-attention";
import { buildMobileMoneyStatusAssistantPayload } from "@/utils/product-sale-paystack";
import { scheduleSettlementVerificationIfStale } from "@/utils/paystack-settlement-verification";
import { canResolvePaystackAttention } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";

export {
  canCollectPaystackPayments,
  canViewPaystackAttentionList,
  formatPaystackPaymentAge,
  mobileMoneyStatusAccessError,
  paystackPaymentsPendingAccessError,
} from "@/utils/assistant-staff-r55-helpers";

const PAYSTACK_PENDING_LIMIT = LIST_LIMIT;

function snapshotBusinessUnitId(
  cartSnapshot: unknown,
): string | null {
  if (!cartSnapshot || typeof cartSnapshot !== "object") {
    return null;
  }
  const value = (cartSnapshot as Record<string, unknown>).businessUnitId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function snapshotCustomerName(cartSnapshot: unknown): string | null {
  if (!cartSnapshot || typeof cartSnapshot !== "object") {
    return null;
  }
  const value = (cartSnapshot as Record<string, unknown>).customerName;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function matchesBusinessUnitScope(
  rowBusinessUnitId: string | null,
  buScope: Awaited<ReturnType<typeof loadStaffBusinessUnitScope>>,
): boolean {
  if (buScope.mode === "all") {
    return true;
  }
  if (buScope.mode === "unit") {
    // Untagged rows stay visible in a unit view (same as many registers).
    return !rowBusinessUnitId || rowBusinessUnitId === buScope.id;
  }
  // default (untagged workspace view): only null/empty BU
  return !rowBusinessUnitId;
}

export async function getPaystackPaymentsPending(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  const accessError = paystackPaymentsPendingAccessError(
    sessionResult.session.role,
  );
  if (accessError) {
    return { error: accessError };
  }

  const includeAwaiting = canCollectPaystackPayments(sessionResult.session.role);
  const includeAttention = canViewPaystackAttentionList(
    sessionResult.session.role,
  );

  try {
    const supabase = await getStaffSupabase();
    const buScope = await loadStaffBusinessUnitScope();
    const now = new Date();

    const awaiting: Array<Record<string, unknown>> = [];
    const needingAttention: Array<Record<string, unknown>> = [];

    if (includeAwaiting) {
      const { data, error } = await supabase
        .from("product_sale_payment_requests")
        .select(
          "id, invoice_no, amount_requested, status, payment_method, paystack_reference, cart_snapshot, created_at",
        )
        .eq("tenant_id", sessionResult.session.tenantId)
        .in("status", ["pending", "sent"])
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        return {
          error: STAFF_DATA_UNAVAILABLE_MESSAGE,
          fetchWarning: error.message,
        };
      }

      for (const row of data ?? []) {
        const buId = snapshotBusinessUnitId(row.cart_snapshot);
        if (!matchesBusinessUnitScope(buId, buScope)) {
          continue;
        }
        const age = formatPaystackPaymentAge(
          row.created_at as string | null,
          now,
        );
        awaiting.push({
          kind: "awaiting_confirmation",
          amountGhs: Math.round((Number(row.amount_requested) || 0) * 100) / 100,
          reference:
            (row.paystack_reference as string | null)?.trim() ||
            (row.invoice_no as string | null) ||
            null,
          invoiceNo: row.invoice_no,
          customerName: snapshotCustomerName(row.cart_snapshot) || "Customer",
          status: row.status,
          paymentMethod: row.payment_method,
          ageLabel: age.ageLabel,
          ageHours: age.ageHours,
          createdAt: row.created_at,
        });
        if (awaiting.length >= PAYSTACK_PENDING_LIMIT) {
          break;
        }
      }
    }

    if (includeAttention) {
      const { data, error } = await supabase
        .from(PAYSTACK_ATTENTION_TABLE)
        .select(
          "id, payment_request_id, paystack_reference, amount, customer_label, reason, status, created_at",
        )
        .eq("tenant_id", sessionResult.session.tenantId)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        if (!isMissingPaystackAttentionTable(error)) {
          return {
            error: STAFF_DATA_UNAVAILABLE_MESSAGE,
            fetchWarning: error.message,
          };
        }
      } else {
        const requestIds = [
          ...new Set(
            (data ?? [])
              .map((row) => String(row.payment_request_id ?? ""))
              .filter(Boolean),
          ),
        ];
        const buByRequestId = new Map<string, string | null>();
        if (requestIds.length > 0 && buScope.mode !== "all") {
          const { data: requests } = await supabase
            .from("product_sale_payment_requests")
            .select("id, cart_snapshot")
            .eq("tenant_id", sessionResult.session.tenantId)
            .in("id", requestIds);
          for (const request of requests ?? []) {
            buByRequestId.set(
              String(request.id),
              snapshotBusinessUnitId(request.cart_snapshot),
            );
          }
        }

        for (const row of data ?? []) {
          const requestId = String(row.payment_request_id ?? "");
          const buId =
            buScope.mode === "all"
              ? null
              : (buByRequestId.get(requestId) ?? null);
          if (
            buScope.mode !== "all" &&
            !matchesBusinessUnitScope(buId, buScope)
          ) {
            continue;
          }
          const age = formatPaystackPaymentAge(
            row.created_at as string | null,
            now,
          );
          needingAttention.push({
            kind: "needing_attention",
            amountGhs: Math.round((Number(row.amount) || 0) * 100) / 100,
            reference: row.paystack_reference,
            customerName:
              (row.customer_label as string | null)?.trim() || "Customer",
            reason: row.reason,
            ageLabel: age.ageLabel,
            ageHours: age.ageHours,
            createdAt: row.created_at,
            canResolve: canResolvePaystackAttention(sessionResult.session.role),
          });
          if (needingAttention.length >= PAYSTACK_PENDING_LIMIT) {
            break;
          }
        }
      }
    }

    return {
      awaitingConfirmation: awaiting,
      needingAttention,
      awaitingCount: awaiting.length,
      needingAttentionCount: needingAttention.length,
      note: includeAttention
        ? "Awaiting = product_sale_payment_requests pending/sent. Needing attention = open paystack_payment_attention rows."
        : "Awaiting Paystack confirmation only (your role cannot open Payments needing attention).",
    };
  } catch (error) {
    console.error("[assistant] get_paystack_payments_pending threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}

export async function getMobileMoneyStatus(): Promise<unknown> {
  const sessionResult = await requireStaffSession();
  if ("error" in sessionResult) {
    return sessionResult;
  }
  const accessError = mobileMoneyStatusAccessError(sessionResult.session.role);
  if (accessError) {
    return { error: accessError };
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("billing_settings")
      .select(
        "paystack_subaccount_code, paystack_subaccount_status, paystack_subaccount_verified_ok, paystack_subaccount_last_verified_at, paystack_subaccount_last_verify_error",
      )
      .eq("tenant_id", sessionResult.session.tenantId)
      .maybeSingle();

    if (error) {
      console.error("[assistant] get_mobile_money_status load failed:", error);
      return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
    }

    const payload = buildMobileMoneyStatusAssistantPayload({
      paystack_subaccount_status: data?.paystack_subaccount_status,
      paystack_subaccount_code: data?.paystack_subaccount_code,
      paystack_subaccount_verified_ok: data?.paystack_subaccount_verified_ok,
      paystack_subaccount_last_verified_at:
        data?.paystack_subaccount_last_verified_at,
      paystack_subaccount_last_verify_error:
        data?.paystack_subaccount_last_verify_error,
      role: sessionResult.session.role,
    });

    if (payload.ready) {
      scheduleSettlementVerificationIfStale(
        sessionResult.session.tenantId,
        data?.paystack_subaccount_last_verified_at,
      );
    }

    return payload;
  } catch (error) {
    console.error("[assistant] get_mobile_money_status threw:", error);
    return { error: STAFF_DATA_UNAVAILABLE_MESSAGE };
  }
}
