import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import {
  allocatePaymentAcrossLines,
  PRODUCT_SALE_PAYSTACK_CONTEXT,
  roundGhs,
  type ProductSaleIncomeLine,
} from "@/utils/product-sale-paystack";
import {
  fulfillPosCartSnapshotPaymentRequest,
  loadPaymentRequestForFulfillment,
  paymentMethodFromPaystackChannel,
} from "@/utils/pos-momo-fulfillment";
import { postProductSalePaystackFee } from "@/utils/paystack-finance-posting";
import { tryApplyProductSalePaystackPayment } from "@/utils/paystack-payment-apply";
import {
  PaystackPaymentNeedsAttentionError,
  paystackAttentionMessage,
  recordPaystackPaymentAttention,
} from "@/utils/paystack-payment-attention";
import {
  notesWithPaystackReference,
  paystackOverpaymentReason,
} from "@/utils/manual-sale-paystack";
import { notesWithPaymentMethod } from "@/utils/product-sale-payments-types";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataObject(data: JsonRecord): JsonRecord {
  const meta = asRecord(data.metadata);
  return meta ?? {};
}

function pesewasToGhs(pesewas: number): number {
  return roundGhs(pesewas / 100);
}

export function isProductSalePaystackContext(
  data: JsonRecord,
): boolean {
  const meta = metadataObject(data);
  return asString(meta.context) === PRODUCT_SALE_PAYSTACK_CONTEXT;
}

/**
 * Apply a successful Paystack charge to POS/product-sale income lines,
 * or create sales from cart_snapshot for charge-first flows
 * (Instant MoMo Inline + Request Payment link).
 */
export async function processProductSalePaystackEvent(
  data: JsonRecord,
): Promise<{
  detail: string;
  ignored?: boolean;
  needsAttention?: boolean;
  /** Another path (webhook, popup, Check payment, nightly) applied it first. */
  alreadyApplied?: boolean;
}> {
  const meta = metadataObject(data);
  const reference = asString(data.reference);
  const paymentRequestId = asString(meta.payment_request_id);
  const metadataTenantId = asString(meta.tenant_id);
  const invoiceNo = asString(meta.invoice_no);
  const paystackChannel =
    asString(data.channel) ??
    asString(asRecord(data.authorization)?.channel);

  const amountPesewas = asNumber(data.amount);
  const paidAmountGhs =
    amountPesewas != null ? pesewasToGhs(amountPesewas) : null;
  const paidAt =
    asString(data.paid_at) ??
    asString(data.paidAt) ??
    new Date().toISOString();

  const admin = createAdminClient();
  const requestRow = await loadPaymentRequestForFulfillment(admin, {
    paymentRequestId,
    reference,
  });

  if (!requestRow) {
    return {
      ignored: true,
      detail: `product_sale charge.success ${reference ?? paymentRequestId ?? ""} — payment request not found.`,
    };
  }

  if (metadataTenantId && requestRow.tenant_id !== metadataTenantId) {
    return {
      ignored: true,
      detail: `product_sale charge.success ${reference ?? ""} — tenant_id metadata mismatch.`,
    };
  }

  if (requestRow.status === "paid") {
    if (reference && paidAmountGhs != null && paidAmountGhs > 0) {
      await postProductSalePaystackFee(admin, {
        tenantId: requestRow.tenant_id,
        reference,
        transactionAmountGhs: paidAmountGhs,
        paidAt,
        flowLabel: "Product sale payment",
        invoiceNo: invoiceNo ?? requestRow.invoice_no,
        incomeIds: requestRow.income_ids,
      });
    }
    return {
      alreadyApplied: true,
      detail: `product_sale charge.success ${reference ?? ""} — request ${requestRow.id} already paid (idempotent).`,
    };
  }

  const incomeIds = Array.isArray(requestRow.income_ids)
    ? requestRow.income_ids.filter(Boolean)
    : [];

  if (incomeIds.length === 0 && requestRow.cart_snapshot) {
    try {
      const fulfilled = await fulfillPosCartSnapshotPaymentRequest(
        admin,
        requestRow,
        {
          reference,
          paidAmountGhs,
          paidAt,
          skipVerify: true,
          paystackChannel,
        },
      );
      return {
        alreadyApplied: fulfilled.alreadyFulfilled,
        detail: `product_sale charge.success created POS sale invoice ${fulfilled.invoiceNo} from cart_snapshot (${fulfilled.incomeIds.length} line(s), method=${fulfilled.paymentMethod}, request ${requestRow.id}, ref=${reference ?? "n/a"}).`,
      };
    } catch (error) {
      if (error instanceof PaystackPaymentNeedsAttentionError) {
        return { detail: error.message, needsAttention: true };
      }
      throw error;
    }
  }

  if (incomeIds.length === 0) {
    throw new Error(
      `Payment request ${requestRow.id} has empty income_ids and no cart_snapshot.`,
    );
  }

  const { data: incomeRows, error: incomeError } = await admin
    .from("income_register")
    .select(
      "id, amount, amount_received, outstanding_balance, payment_status, sale_status, notes",
    )
    .eq("tenant_id", requestRow.tenant_id)
    .eq("entry_type", "product_sale")
    .in("id", incomeIds);

  if (incomeError) {
    throw new Error(incomeError.message);
  }

  const activeLines = ((incomeRows as ProductSaleIncomeLine[] | null) ?? []).filter(
    (row) =>
      (row.sale_status ?? "active") !== "voided" &&
      (row as { is_sale_return?: boolean }).is_sale_return !== true,
  );

  if (activeLines.length === 0) {
    await admin
      .from("product_sale_payment_requests")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
        email_error: "No active income lines to apply payment.",
      })
      .eq("id", requestRow.id);

    return {
      ignored: true,
      detail: `product_sale charge.success ${reference ?? ""} — no active income lines for request ${requestRow.id}.`,
    };
  }

  const applyAmount =
    paidAmountGhs != null && paidAmountGhs > 0
      ? paidAmountGhs
      : roundGhs(Number(requestRow.amount_requested) || 0);

  if (reference) {
    const atomic = await tryApplyProductSalePaystackPayment(admin, {
      requestId: requestRow.id,
      reference,
      amount: applyAmount,
    });
    if (atomic.status === "applied") {
      const appliedInvoice = atomic.invoiceNo || invoiceNo || requestRow.invoice_no;
      if (atomic.unallocatedAmount > 0) {
        await recordPaystackPaymentAttention(admin, {
          tenantId: requestRow.tenant_id,
          paymentRequestId: requestRow.id,
          reference,
          amount: atomic.unallocatedAmount,
          customerLabel:
            requestRow.cart_snapshot?.customerName ||
            requestRow.cart_snapshot?.clientId ||
            null,
          clientId: requestRow.cart_snapshot?.clientId ?? null,
          reason: paystackOverpaymentReason(
            atomic.unallocatedAmount,
            appliedInvoice,
          ),
        });
      }
      await postProductSalePaystackFee(admin, {
        tenantId: requestRow.tenant_id,
        reference,
        transactionAmountGhs: applyAmount,
        paidAt,
        flowLabel: "Product sale payment",
        invoiceNo: appliedInvoice,
        incomeIds: atomic.incomeIds.length > 0 ? atomic.incomeIds : incomeIds,
      });
      return {
        alreadyApplied: atomic.alreadyApplied,
        detail: `product_sale charge.success applied ${reference} on request ${requestRow.id} in one transaction (invoice ${appliedInvoice}).`,
      };
    }
    if (atomic.status === "error") {
      const saved = await recordPaystackPaymentAttention(admin, {
        tenantId: requestRow.tenant_id,
        paymentRequestId: requestRow.id,
        reference,
        amount: applyAmount,
        customerLabel:
          requestRow.cart_snapshot?.customerName ||
          requestRow.cart_snapshot?.clientId ||
          null,
        clientId: requestRow.cart_snapshot?.clientId ?? null,
        reason: atomic.error,
      });
      const message = paystackAttentionMessage({
        amount: applyAmount,
        reference,
        customer:
          requestRow.cart_snapshot?.customerName ||
          requestRow.cart_snapshot?.clientId ||
          "",
        reason: atomic.error,
        stored: saved.stored,
      });
      if (saved.stored) {
        return { detail: message, needsAttention: true };
      }
      throw new Error(message);
    }
  }

  const allocations = allocatePaymentAcrossLines(activeLines, applyAmount);

  const tender = paymentMethodFromPaystackChannel(
    paystackChannel,
    requestRow.payment_method,
  );
  const paidOn = paidAt.slice(0, 10);

  for (const allocation of allocations) {
    const source = activeLines.find((line) => line.id === allocation.id);
    const nextNotes =
      reference && allocation.applied > 0
        ? notesWithPaystackReference(
            notesWithPaymentMethod(source?.notes, tender),
            reference,
          )
        : null;
    const { error: updateError } = await admin
      .from("income_register")
      .update({
        amount_received: allocation.nextAmountReceived,
        outstanding_balance: allocation.nextOutstanding,
        payment_status: allocation.nextPaymentStatus,
        ...(nextNotes ? { notes: nextNotes } : {}),
      })
      .eq("id", allocation.id)
      .eq("tenant_id", requestRow.tenant_id);

    if (updateError) {
      throw new Error(
        `Failed updating income ${allocation.id}: ${updateError.message}`,
      );
    }

    if (allocation.applied > 0 && reference) {
      const refNote = `Paystack ref: ${reference}`;
      const { data: existingPayment, error: existingPaymentError } = await admin
        .from("product_sale_payments")
        .select("id")
        .eq("tenant_id", requestRow.tenant_id)
        .eq("income_id", allocation.id)
        .eq("notes", refNote)
        .limit(1)
        .maybeSingle();
      if (existingPaymentError) {
        throw new Error(existingPaymentError.message);
      }
      if (!existingPayment?.id) {
        const { error: paymentError } = await admin
          .from("product_sale_payments")
          .insert({
            tenant_id: requestRow.tenant_id,
            income_id: allocation.id,
            payment_date: paidOn,
            amount: allocation.applied,
            payment_method: tender,
            notes: refNote,
            recorded_by: null,
          });
        if (paymentError) {
          throw new Error(paymentError.message);
        }
      }
    }
  }

  const appliedTotal = roundGhs(
    allocations.reduce((sum, allocation) => sum + allocation.applied, 0),
  );
  const unallocated = roundGhs(applyAmount - appliedTotal);
  const appliedInvoice = invoiceNo || requestRow.invoice_no;
  if (unallocated > 0 && reference) {
    await recordPaystackPaymentAttention(admin, {
      tenantId: requestRow.tenant_id,
      paymentRequestId: requestRow.id,
      reference,
      amount: unallocated,
      customerLabel:
        requestRow.cart_snapshot?.customerName ||
        requestRow.cart_snapshot?.clientId ||
        null,
      clientId: requestRow.cart_snapshot?.clientId ?? null,
      reason: paystackOverpaymentReason(unallocated, appliedInvoice),
    });
  }

  const { error: markPaidError } = await admin
    .from("product_sale_payment_requests")
    .update({
      status: "paid",
      paid_amount: applyAmount,
      paid_at: paidAt,
      paystack_reference: reference ?? requestRow.paystack_reference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id)
    .eq("tenant_id", requestRow.tenant_id);

  if (markPaidError) {
    throw new Error(markPaidError.message);
  }

  if (!reference) {
    throw new Error(
      `product_sale charge.success request ${requestRow.id}: missing Paystack reference — fee not posted.`,
    );
  }

  await postProductSalePaystackFee(admin, {
    tenantId: requestRow.tenant_id,
    reference,
    transactionAmountGhs: applyAmount,
    paidAt,
    flowLabel: "Product sale payment",
    invoiceNo: invoiceNo ?? requestRow.invoice_no,
    incomeIds,
  });

  // Payment on an already-created sale (not cart_snapshot create) — payment_received only.
  const { data: customerLine } = await admin
    .from("income_register")
    .select("client_id, customer_name, invoice_no, business_unit_id")
    .eq("tenant_id", requestRow.tenant_id)
    .in("id", incomeIds)
    .limit(1)
    .maybeSingle();

  void import("@/utils/transactional-notification-trigger").then(
    ({ fireTransactionalNotification }) => {
      void fireTransactionalNotification(
        requestRow.tenant_id,
        "payment_received",
        customerLine?.client_id ?? null,
        {
          customer_name:
            customerLine?.customer_name?.trim() ||
            customerLine?.client_id ||
            "Customer",
          amount: String(applyAmount),
          payment_reference: reference ?? requestRow.paystack_reference ?? "",
          invoice_no:
            invoiceNo ??
            customerLine?.invoice_no ??
            requestRow.invoice_no ??
            "",
        },
        {
          businessUnitId:
            (customerLine?.business_unit_id as string | null | undefined)?.trim() ||
            null,
        },
      );
    },
  );

  return {
    detail: `product_sale charge.success applied GHS ${applyAmount.toFixed(2)} to invoice ${invoiceNo ?? requestRow.invoice_no} (${allocations.length} line(s), request ${requestRow.id}, ref=${reference ?? "n/a"}).`,
  };
}
