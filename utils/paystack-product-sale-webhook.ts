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
} from "@/utils/pos-momo-fulfillment";
import { postProductSalePaystackFee } from "@/utils/paystack-finance-posting";

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
): Promise<{ detail: string; ignored?: boolean }> {
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
      });
    }
    return {
      detail: `product_sale charge.success ${reference ?? ""} — request ${requestRow.id} already paid (idempotent).`,
    };
  }

  const incomeIds = Array.isArray(requestRow.income_ids)
    ? requestRow.income_ids.filter(Boolean)
    : [];

  if (incomeIds.length === 0 && requestRow.cart_snapshot) {
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
      detail: `product_sale charge.success created POS sale invoice ${fulfilled.invoiceNo} from cart_snapshot (${fulfilled.incomeIds.length} line(s), method=${fulfilled.paymentMethod}, request ${requestRow.id}, ref=${reference ?? "n/a"}).`,
    };
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
    (row) => (row.sale_status ?? "active") !== "voided",
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

  const allocations = allocatePaymentAcrossLines(activeLines, applyAmount);

  for (const allocation of allocations) {
    const { error: updateError } = await admin
      .from("income_register")
      .update({
        amount_received: allocation.nextAmountReceived,
        outstanding_balance: allocation.nextOutstanding,
        payment_status: allocation.nextPaymentStatus,
      })
      .eq("id", allocation.id)
      .eq("tenant_id", requestRow.tenant_id);

    if (updateError) {
      throw new Error(
        `Failed updating income ${allocation.id}: ${updateError.message}`,
      );
    }
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
