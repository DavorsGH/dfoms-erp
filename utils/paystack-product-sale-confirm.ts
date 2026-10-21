import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logSystemEvent, type LogSystemEventInput } from "@/lib/system-event-log";
import { verifyPaystackTransaction } from "@/utils/paystack";
import {
  loadPaymentRequestForFulfillment,
  type PaymentRequestRow,
} from "@/utils/pos-momo-fulfillment";
import { processProductSalePaystackEvent } from "@/utils/paystack-product-sale-webhook";
import {
  PRODUCT_SALE_PAYSTACK_CONTEXT,
  roundGhs,
} from "@/utils/product-sale-paystack";
import { createAdminClient } from "@/utils/supabase/admin";
import { PAYSTACK_NOT_CONFIRMED_MESSAGE } from "@/utils/paystack-confirm-client";

export const PAYSTACK_CONFIRM_EVENT_NAME = "paystack-product-sale-confirm";

export { PAYSTACK_NOT_CONFIRMED_MESSAGE };

/** Where a verify-and-apply attempt came from. All of them share one code path. */
export type PaystackConfirmSource =
  | "popup_success"
  | "popup_closed"
  | "popup_poll"
  | "check_payment"
  | "nightly_reconciliation";

export const PAYSTACK_CONFIRM_SOURCES: readonly PaystackConfirmSource[] = [
  "popup_success",
  "popup_closed",
  "popup_poll",
  "check_payment",
  "nightly_reconciliation",
];

export type PaystackConfirmOutcome =
  | {
      outcome: "applied" | "already_applied";
      requestId: string;
      reference: string;
      invoiceNo: string;
      incomeIds: string[];
      paymentMethod: string;
      amountGhs: number | null;
    }
  | {
      outcome: "not_paid";
      requestId: string;
      reference: string;
      paystackStatus: string;
      message: string;
    }
  | {
      outcome: "mismatch" | "needs_attention" | "error";
      requestId: string | null;
      reference: string;
      message: string;
    }
  | { outcome: "not_found"; requestId: null; reference: string; message: string }
  | { outcome: "forbidden"; requestId: string; reference: string; message: string };

export type PaystackConfirmInput = {
  paymentRequestId?: string | null;
  reference?: string | null;
  source: PaystackConfirmSource;
  /** When set, the request must belong to this tenant (user-triggered paths). */
  tenantId?: string | null;
  actorUserId?: string | null;
};

type ProcessResult = Awaited<ReturnType<typeof processProductSalePaystackEvent>>;

export type PaystackConfirmDeps = {
  admin: SupabaseClient;
  verify: typeof verifyPaystackTransaction;
  loadRequest: (
    admin: SupabaseClient,
    options: { paymentRequestId?: string | null; reference?: string | null },
  ) => Promise<PaymentRequestRow | null>;
  apply: (data: Record<string, unknown>) => Promise<ProcessResult>;
  log: (input: LogSystemEventInput) => Promise<void>;
};

function resolveDeps(overrides: Partial<PaystackConfirmDeps>): PaystackConfirmDeps {
  return {
    admin: overrides.admin ?? createAdminClient(),
    verify: overrides.verify ?? verifyPaystackTransaction,
    loadRequest: overrides.loadRequest ?? loadPaymentRequestForFulfillment,
    apply: overrides.apply ?? processProductSalePaystackEvent,
    log: overrides.log ?? logSystemEvent,
  };
}

/**
 * Pure amount / currency / reference gate. The client is never trusted: every
 * value here comes from the Paystack Verify Transaction response and our request row.
 * Underpayment is refused. Overpayment is applied; the apply function parks the
 * surplus as an attention row.
 */
export function validatePaystackVerification(input: {
  requestedReference: string | null | undefined;
  storedReference: string | null | undefined;
  verifiedReference: string | null | undefined;
  verifiedAmountPesewas: number | null | undefined;
  verifiedCurrency: string | null | undefined;
  requestedAmountGhs: number;
}): { ok: true; amountGhs: number } | { ok: false; reason: string } {
  const verifiedRef = (input.verifiedReference ?? "").trim();
  const stored = (input.storedReference ?? "").trim();
  const requested = (input.requestedReference ?? "").trim();
  if (!verifiedRef) {
    return { ok: false, reason: "Paystack did not return a reference." };
  }
  if (requested && requested !== verifiedRef) {
    return {
      ok: false,
      reason: `Reference mismatch: asked for ${requested}, Paystack returned ${verifiedRef}.`,
    };
  }
  if (stored && stored !== verifiedRef) {
    return {
      ok: false,
      reason: `Reference mismatch: this request expects ${stored}, Paystack returned ${verifiedRef}.`,
    };
  }
  const currency = (input.verifiedCurrency ?? "GHS").trim().toUpperCase();
  if (currency !== "GHS") {
    return { ok: false, reason: `Unexpected currency ${currency}. Expected GHS.` };
  }
  if (
    input.verifiedAmountPesewas == null ||
    !Number.isFinite(input.verifiedAmountPesewas) ||
    input.verifiedAmountPesewas <= 0
  ) {
    return { ok: false, reason: "Paystack did not return a paid amount." };
  }
  const amountGhs = roundGhs(input.verifiedAmountPesewas / 100);
  const requestedAmount = roundGhs(Number(input.requestedAmountGhs) || 0);
  if (requestedAmount > 0 && amountGhs < requestedAmount - 0.009) {
    return {
      ok: false,
      reason: `Paystack paid GHS ${amountGhs.toFixed(2)} but GHS ${requestedAmount.toFixed(2)} was requested.`,
    };
  }
  return { ok: true, amountGhs };
}

/**
 * Verify a product-sale Paystack payment with Paystack and apply it once.
 * Shared by popup success, popup closed, Check payment and nightly reconciliation.
 * The webhook uses the same apply function, so whichever path runs first applies
 * the payment and every later path returns `already_applied`.
 */
export async function confirmProductSalePaystackPayment(
  input: PaystackConfirmInput,
  overrides: Partial<PaystackConfirmDeps> = {},
): Promise<PaystackConfirmOutcome> {
  const deps = resolveDeps(overrides);
  // Background polling is quiet: its log rows are written only when it finds
  // something other than "not paid yet".
  const quiet = input.source === "popup_poll";
  const buffered: LogSystemEventInput[] = [];
  const emit = quiet
    ? async (event: LogSystemEventInput) => {
        buffered.push(event);
      }
    : deps.log;
  const result = await runConfirm(input, deps, emit);
  if (quiet && result.outcome !== "not_paid") {
    for (const event of buffered) {
      await deps.log(event);
    }
  }
  return result;
}

async function runConfirm(
  input: PaystackConfirmInput,
  deps: PaystackConfirmDeps,
  emit: (event: LogSystemEventInput) => Promise<void>,
): Promise<PaystackConfirmOutcome> {
  const suppliedReference = (input.reference ?? "").trim();
  const suppliedRequestId = (input.paymentRequestId ?? "").trim();
  const baseMetadata = {
    source: input.source,
    payment_request_id: suppliedRequestId || null,
    reference: suppliedReference || null,
    tenant_id: input.tenantId ?? null,
    actor_user_id: input.actorUserId ?? null,
  };

  async function step(
    name: string,
    status: LogSystemEventInput["status"],
    message: string,
    extra: Record<string, unknown> = {},
  ) {
    await emit({
      eventType: "payment",
      eventName: PAYSTACK_CONFIRM_EVENT_NAME,
      status,
      message: `[${input.source}] ${name}: ${message}`,
      metadata: { ...baseMetadata, step: name, ...extra },
    });
  }

  await step("received", "success", "Confirm requested.");

  if (!suppliedRequestId && !suppliedReference) {
    await step("rejected", "failure", "No payment request id or reference.");
    return {
      outcome: "error",
      requestId: null,
      reference: "",
      message: "payment_request_id or reference is required.",
    };
  }

  let requestRow: PaymentRequestRow | null;
  try {
    requestRow = await deps.loadRequest(deps.admin, {
      paymentRequestId: suppliedRequestId || null,
      reference: suppliedRequestId ? null : suppliedReference || null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request lookup failed.";
    await step("request_lookup", "failure", message);
    return { outcome: "error", requestId: null, reference: suppliedReference, message };
  }

  if (!requestRow) {
    await step("request_lookup", "failure", "Payment request not found.");
    return {
      outcome: "not_found",
      requestId: null,
      reference: suppliedReference,
      message: "Payment request not found.",
    };
  }

  const reference = suppliedReference || (requestRow.paystack_reference ?? "").trim();
  const requestId = requestRow.id;

  if (input.tenantId && requestRow.tenant_id !== input.tenantId) {
    await step("tenant_check", "failure", "Request belongs to another tenant.", {
      payment_request_id: requestId,
    });
    return {
      outcome: "forbidden",
      requestId,
      reference,
      message: "Forbidden",
    };
  }

  await step("request_loaded", "success", `Request status ${requestRow.status}.`, {
    payment_request_id: requestId,
    request_status: requestRow.status,
    invoice_no: requestRow.invoice_no,
  });

  const alreadyApplied = (): PaystackConfirmOutcome => ({
    outcome: "already_applied",
    requestId,
    reference,
    invoiceNo: requestRow!.invoice_no,
    incomeIds: requestRow!.income_ids ?? [],
    paymentMethod: requestRow!.payment_method,
    amountGhs: null,
  });

  if (requestRow.status === "paid") {
    await step("already_applied", "success", "Already applied. Nothing to do.", {
      payment_request_id: requestId,
    });
    return alreadyApplied();
  }

  if (requestRow.status === "cancelled" || requestRow.status === "failed") {
    await step(
      "request_closed",
      "warning",
      `Request is ${requestRow.status}. Verifying with Paystack in case money moved.`,
      { payment_request_id: requestId, request_status: requestRow.status },
    );
  }

  if (!reference) {
    await step("verify", "failure", "Request has no Paystack reference.", {
      payment_request_id: requestId,
    });
    return {
      outcome: "error",
      requestId,
      reference: "",
      message: "Missing Paystack reference.",
    };
  }

  const verified = await deps.verify(reference);
  if (!verified.ok) {
    await step("verify", "failure", `Paystack verify failed: ${verified.error}`, {
      payment_request_id: requestId,
    });
    return { outcome: "error", requestId, reference, message: verified.error };
  }
  await step("verify", "success", `Paystack status ${verified.status}.`, {
    payment_request_id: requestId,
    paystack_status: verified.status,
    paystack_amount_pesewas: verified.amount,
    paystack_currency: verified.currency,
  });

  if (verified.status !== "success") {
    await step("not_paid", "warning", `Paystack status is ${verified.status}.`, {
      payment_request_id: requestId,
      paystack_status: verified.status,
    });
    return {
      outcome: "not_paid",
      requestId,
      reference,
      paystackStatus: verified.status,
      message: PAYSTACK_NOT_CONFIRMED_MESSAGE,
    };
  }

  const gate = validatePaystackVerification({
    requestedReference: suppliedReference,
    storedReference: requestRow.paystack_reference,
    verifiedReference: verified.reference,
    verifiedAmountPesewas: verified.amount,
    verifiedCurrency: verified.currency,
    requestedAmountGhs: Number(requestRow.amount_requested) || 0,
  });
  if (!gate.ok) {
    await step("validate", "failure", gate.reason, { payment_request_id: requestId });
    return { outcome: "mismatch", requestId, reference, message: gate.reason };
  }
  await step("validate", "success", `Verified GHS ${gate.amountGhs.toFixed(2)}.`, {
    payment_request_id: requestId,
    verified_amount_ghs: gate.amountGhs,
  });

  let processed: ProcessResult;
  try {
    processed = await deps.apply({
      reference: verified.reference,
      amount: verified.amount,
      channel: verified.channel,
      paid_at: verified.paidAt,
      metadata: {
        context: PRODUCT_SALE_PAYSTACK_CONTEXT,
        tenant_id: requestRow.tenant_id,
        invoice_no: requestRow.invoice_no,
        payment_request_id: requestRow.id,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to record the sale after payment.";
    await step("apply", "failure", message, { payment_request_id: requestId });
    return { outcome: "error", requestId, reference, message };
  }

  if (processed.needsAttention || processed.ignored) {
    await step("apply", "warning", processed.detail, {
      payment_request_id: requestId,
      needs_attention: processed.needsAttention === true,
    });
    return {
      outcome: "needs_attention",
      requestId,
      reference,
      message: processed.detail,
    };
  }

  let latest: PaymentRequestRow | null = null;
  try {
    latest = await deps.loadRequest(deps.admin, { paymentRequestId: requestId });
  } catch {
    latest = null;
  }

  const outcome: "applied" | "already_applied" =
    processed.alreadyApplied === true ? "already_applied" : "applied";
  await step(outcome, "success", processed.detail, {
    payment_request_id: requestId,
    applied_amount_ghs: gate.amountGhs,
  });
  return {
    outcome,
    requestId,
    reference: verified.reference,
    invoiceNo: latest?.invoice_no ?? requestRow.invoice_no,
    incomeIds: latest?.income_ids ?? requestRow.income_ids ?? [],
    paymentMethod: latest?.payment_method ?? requestRow.payment_method,
    amountGhs: gate.amountGhs,
  };
}

/** HTTP status and JSON body for a confirm outcome (route and tests share this). */
export function paystackConfirmResponse(result: PaystackConfirmOutcome): {
  status: number;
  body: Record<string, unknown>;
} {
  switch (result.outcome) {
    case "applied":
    case "already_applied":
      return {
        status: 200,
        body: {
          ok: true,
          outcome: result.outcome,
          already_applied: result.outcome === "already_applied",
          already_fulfilled: result.outcome === "already_applied",
          invoice_no: result.invoiceNo,
          income_ids: result.incomeIds,
          payment_method: result.paymentMethod,
          reference: result.reference,
          amount_ghs: result.amountGhs,
          message:
            result.outcome === "already_applied"
              ? "Payment already applied."
              : "Payment confirmed and applied.",
        },
      };
    case "not_paid":
      return {
        status: 200,
        body: {
          ok: false,
          outcome: "not_paid",
          not_paid: true,
          status: result.paystackStatus,
          reference: result.reference,
          error: result.message,
        },
      };
    case "not_found":
      return {
        status: 404,
        body: { ok: false, outcome: result.outcome, error: result.message },
      };
    case "forbidden":
      return {
        status: 403,
        body: { ok: false, outcome: result.outcome, error: result.message },
      };
    case "mismatch":
    case "needs_attention":
      return {
        status: 409,
        body: { ok: false, outcome: result.outcome, error: result.message },
      };
    default:
      return {
        status: 502,
        body: { ok: false, outcome: result.outcome, error: result.message },
      };
  }
}

export type PaystackNightlySweepResult = {
  checked: number;
  applied: number;
  alreadyApplied: number;
  notPaid: number;
  failed: number;
  details: Array<{ requestId: string; reference: string; outcome: string; message?: string }>;
};

export const PAYSTACK_SWEEP_MIN_AGE_MINUTES = 15;
const PAYSTACK_SWEEP_MAX_AGE_DAYS = 30;
const PAYSTACK_SWEEP_LIMIT = 200;

/**
 * Nightly: verify product_sale_payment_requests still pending/sent that have a
 * reference older than 15 minutes, and apply the ones Paystack says are paid.
 */
export async function sweepOpenProductSalePaystackRequests(
  overrides: Partial<PaystackConfirmDeps> & { now?: Date } = {},
): Promise<PaystackNightlySweepResult> {
  const admin = overrides.admin ?? createAdminClient();
  const { now: nowOverride, ...depOverrides } = overrides;
  const now = nowOverride ?? new Date();
  const olderThan = new Date(
    now.getTime() - PAYSTACK_SWEEP_MIN_AGE_MINUTES * 60 * 1000,
  ).toISOString();
  const newerThan = new Date(
    now.getTime() - PAYSTACK_SWEEP_MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await admin
    .from("product_sale_payment_requests")
    .select("id, tenant_id, paystack_reference, status, created_at")
    .in("status", ["pending", "sent"])
    .not("paystack_reference", "is", null)
    .lt("created_at", olderThan)
    .gt("created_at", newerThan)
    .order("created_at", { ascending: true })
    .limit(PAYSTACK_SWEEP_LIMIT);
  if (error) {
    throw new Error(`product_sale_payment_requests sweep lookup failed: ${error.message}`);
  }

  const result: PaystackNightlySweepResult = {
    checked: 0,
    applied: 0,
    alreadyApplied: 0,
    notPaid: 0,
    failed: 0,
    details: [],
  };

  for (const row of (data ?? []) as Array<{
    id: string;
    tenant_id: string;
    paystack_reference: string | null;
  }>) {
    const reference = (row.paystack_reference ?? "").trim();
    if (!reference) {
      continue;
    }
    result.checked += 1;
    const confirmed = await confirmProductSalePaystackPayment(
      {
        paymentRequestId: row.id,
        reference,
        source: "nightly_reconciliation",
        tenantId: row.tenant_id,
      },
      { ...depOverrides, admin },
    );
    const message = "message" in confirmed ? confirmed.message : undefined;
    result.details.push({
      requestId: row.id,
      reference,
      outcome: confirmed.outcome,
      message,
    });
    if (confirmed.outcome === "applied") {
      result.applied += 1;
    } else if (confirmed.outcome === "already_applied") {
      result.alreadyApplied += 1;
    } else if (confirmed.outcome === "not_paid") {
      result.notPaid += 1;
    } else {
      result.failed += 1;
    }
  }
  return result;
}
