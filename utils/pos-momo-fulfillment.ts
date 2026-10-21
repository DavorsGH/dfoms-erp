import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPosNotes,
  lineSubtotal,
  POS_MOMO_PAYMENT_METHOD,
  roundMoney,
  type PosCartLine,
} from "@/app/dashboard/pos/pos-utils";
import {
  isManualSalePaystackSnapshot,
  paystackApplyErrorReason,
  paystackOverpaymentReason,
  paystackSaleIncomeNotes,
  type ManualSaleSnapshotMeta,
} from "@/utils/manual-sale-paystack";
import { verifyPaystackTransaction } from "@/utils/paystack";
import { roundGhs } from "@/utils/product-sale-paystack";
import { postProductSalePaystackFee } from "@/utils/paystack-finance-posting";
import { tryApplyProductSalePaystackPayment } from "@/utils/paystack-payment-apply";
import {
  PaystackPaymentNeedsAttentionError,
  paystackAttentionMessage,
  recordPaystackPaymentAttention,
} from "@/utils/paystack-payment-attention";

export type PosCartSnapshot = {
  saleDate: string;
  clientId: string | null;
  customerName: string | null;
  notes: string | null;
  dueDate: string;
  businessUnitId?: string | null;
  /** Set on charge-first manual sales. Absent on POS carts. */
  salesRepId?: string | null;
  /** Older manual requests. New requests use salesRepId and do not need this. */
  manualSale?: ManualSaleSnapshotMeta | null;
  lines: Array<{
    id: string;
    productId: string;
    productCode: string;
    productName: string;
    unitOfMeasure: string;
    quantity: number;
    unitPrice: number;
  }>;
};

export { POS_MOMO_PAYMENT_METHOD };

export type PaymentRequestRow = {
  id: string;
  tenant_id: string;
  invoice_no: string;
  income_ids: string[] | null;
  paystack_reference: string | null;
  amount_requested: number;
  status: string;
  cart_snapshot: PosCartSnapshot | null;
  payment_method: string;
};

/** Provisional invoice markers used before a real POS invoice is allocated. */
export function isProvisionalPosInvoiceNo(invoiceNo: string): boolean {
  return (
    invoiceNo.startsWith("MOMO-PENDING-") ||
    invoiceNo.startsWith("LINK-PENDING-")
  );
}

/** Map Paystack charge channel to a POS payment-method label. */
export function paymentMethodFromPaystackChannel(
  channel: string | null | undefined,
  fallback: string,
): string {
  const normalized = (channel ?? "").trim().toLowerCase();
  if (
    normalized === "mobile_money" ||
    normalized.includes("mobile_money") ||
    normalized === "mobile money"
  ) {
    return POS_MOMO_PAYMENT_METHOD;
  }
  if (normalized === "card") {
    return "Card";
  }
  if (
    normalized === "bank" ||
    normalized === "bank_transfer" ||
    normalized.includes("bank")
  ) {
    return "Bank Transfer";
  }
  const trimmedFallback = fallback.trim();
  return trimmedFallback || "POS";
}

function asCartSnapshot(value: unknown): PosCartSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as PosCartSnapshot;
  if (!Array.isArray(row.lines) || row.lines.length === 0) {
    return null;
  }
  return row;
}

export function buildCartSnapshot(input: {
  saleDate: string;
  clientId: string | null;
  customerName: string | null;
  notes: string | null;
  dueDate: string;
  businessUnitId?: string | null;
  cartLines: PosCartLine[];
}): PosCartSnapshot {
  return {
    saleDate: input.saleDate,
    clientId: input.clientId,
    customerName: input.customerName,
    notes: input.notes,
    dueDate: input.dueDate,
    businessUnitId: input.businessUnitId ?? null,
    lines: input.cartLines.map((line) => ({
      id: line.id,
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      unitOfMeasure: line.unitOfMeasure,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
    })),
  };
}

export function cartSnapshotTotal(snapshot: PosCartSnapshot): number {
  return roundMoney(
    snapshot.lines.reduce(
      (sum, line) => sum + lineSubtotal(line),
      0,
    ),
  );
}

function snapshotLinesToCheckoutPayload(snapshot: PosCartSnapshot) {
  return snapshot.lines.map((line) => ({
    product_id: line.productId,
    quantity: line.quantity,
    unit_price: line.unitPrice,
  }));
}

/**
 * Charge-first manual sale: one PSI line via create_product_sale.
 * Amount received is the confirmed Paystack amount (partial stays outstanding).
 * POS carts keep checkout_pos_cart, which always records the full line as paid.
 */
async function fulfillManualSalePaymentRequest(
  admin: SupabaseClient,
  requestRow: PaymentRequestRow,
  snapshot: PosCartSnapshot,
  options: {
    reference: string | null;
    paidAmountGhs?: number | null;
    paidAt: string;
    paymentMethod: string;
  },
): Promise<{
  invoiceNo: string;
  incomeIds: string[];
  alreadyFulfilled: boolean;
  paymentMethod: string;
}> {
  if (!snapshot.lines.some((saleLine) => saleLine.productId)) {
    throw new Error(
      `Payment request ${requestRow.id} has no manual sale line to fulfill.`,
    );
  }
  const saleTotal = cartSnapshotTotal(snapshot);
  const collected =
    options.paidAmountGhs != null && options.paidAmountGhs > 0
      ? roundGhs(options.paidAmountGhs)
      : roundGhs(Number(requestRow.amount_requested) || saleTotal);
  if (collected <= 0) {
    throw new Error("Paystack did not confirm an amount to record.");
  }
  const method =
    requestRow.payment_method?.trim() ||
    snapshot.manualSale?.paymentMethod?.trim() ||
    options.paymentMethod;
  const salesRepId =
    snapshot.salesRepId?.trim() ||
    snapshot.manualSale?.salesRepId?.trim() ||
    null;
  const businessUnitId = snapshot.businessUnitId?.trim() || null;
  const reference = options.reference?.trim() || null;

  async function holdUnrecordedPayment(reason: string): Promise<never> {
    const saved = reference
      ? await recordPaystackPaymentAttention(admin, {
          tenantId: requestRow.tenant_id,
          paymentRequestId: requestRow.id,
          reference,
          amount: collected,
          customerLabel: snapshot.customerName || snapshot.clientId,
          clientId: snapshot.clientId,
          reason,
        })
      : { stored: false, created: false };
    const message = paystackAttentionMessage({
      amount: collected,
      reference: reference || "unknown",
      customer: snapshot.customerName || snapshot.clientId || "",
      reason,
      stored: saved.stored,
    });
    if (saved.stored) {
      throw new PaystackPaymentNeedsAttentionError(message);
    }
    throw new Error(message);
  }

  if (reference) {
    const atomic = await tryApplyProductSalePaystackPayment(admin, {
      requestId: requestRow.id,
      reference,
      amount: collected,
    });
    if (atomic.status === "applied") {
      const invoiceNo = atomic.invoiceNo || requestRow.invoice_no;
      if (atomic.unallocatedAmount > 0) {
        await recordPaystackPaymentAttention(admin, {
          tenantId: requestRow.tenant_id,
          paymentRequestId: requestRow.id,
          reference,
          amount: atomic.unallocatedAmount,
          customerLabel: snapshot.customerName || snapshot.clientId,
          clientId: snapshot.clientId,
          reason: paystackOverpaymentReason(atomic.unallocatedAmount, invoiceNo),
        });
      }
      await postProductSalePaystackFee(admin, {
        tenantId: requestRow.tenant_id,
        reference,
        transactionAmountGhs: collected,
        paidAt: options.paidAt,
        flowLabel: "Manual product sale",
        invoiceNo,
        businessUnitId,
        incomeIds: atomic.incomeIds,
      });
      return {
        invoiceNo,
        incomeIds: atomic.incomeIds,
        alreadyFulfilled: atomic.alreadyApplied,
        paymentMethod: method,
      };
    }
    if (atomic.status === "error") {
      await holdUnrecordedPayment(atomic.error);
    }
  }

  if (reference) {
    const { data: existingSale, error: existingError } = await admin
      .from("income_register")
      .select("id, invoice_no")
      .eq("tenant_id", requestRow.tenant_id)
      .eq("entry_type", "product_sale")
      .ilike("notes", `%Paystack ref: ${reference}%`)
      .limit(1)
      .maybeSingle();
    if (existingError) {
      throw new Error(existingError.message);
    }
    const existingId = (existingSale?.id as string | undefined)?.trim();
    if (existingId) {
      const existingInvoice =
        (existingSale?.invoice_no as string | null | undefined)?.trim() ||
        requestRow.invoice_no;
      await admin
        .from("product_sale_payment_requests")
        .update({
          status: "paid",
          invoice_no: existingInvoice,
          income_ids: [existingId],
          paid_amount: collected,
          paid_at: options.paidAt,
          paystack_reference: reference,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestRow.id)
        .eq("tenant_id", requestRow.tenant_id);
      return {
        invoiceNo: existingInvoice,
        incomeIds: [existingId],
        alreadyFulfilled: true,
        paymentMethod: method,
      };
    }
  }

  const notes = reference
    ? paystackSaleIncomeNotes(snapshot.notes, method, reference)
    : snapshot.notes;
  let invoiceNo = isProvisionalPosInvoiceNo(requestRow.invoice_no)
    ? null
    : requestRow.invoice_no.trim() || null;
  let remaining = collected;
  const incomeIds: string[] = [];

  for (const saleLine of snapshot.lines) {
    if (!saleLine.productId) {
      await holdUnrecordedPayment(
        `Payment request ${requestRow.invoice_no} has no sale lines to record`,
      );
    }
    const lineTotal = roundGhs(saleLine.quantity * saleLine.unitPrice);
    const slice = roundGhs(Math.min(Math.max(remaining, 0), lineTotal));
    const paymentStatus =
      lineTotal - slice <= 0.001 ? "Paid" : slice > 0 ? "Partial" : "Unpaid";
    const { data: incomeId, error: saleError } = await admin.rpc(
      "create_product_sale",
      {
        p_date: snapshot.saleDate,
        p_invoice_no: invoiceNo,
        p_client_id: snapshot.clientId,
        p_customer_name: snapshot.clientId ? null : snapshot.customerName,
        p_product_id: saleLine.productId,
        p_quantity: saleLine.quantity,
        p_unit_price: saleLine.unitPrice,
        p_amount_received: slice,
        p_payment_status: paymentStatus,
        p_due_date: snapshot.dueDate || snapshot.saleDate,
        p_description: null,
        p_notes: notes,
        p_invoice_entity_type: "PSI",
        p_sales_rep_id: salesRepId,
        p_business_unit_id: businessUnitId,
      },
    );

    if (saleError || typeof incomeId !== "string" || !incomeId) {
      await holdUnrecordedPayment(
        paystackApplyErrorReason(
          saleError?.message ?? "Could not record the manual sale.",
        ),
      );
    }

    if (!invoiceNo) {
      const { data: created, error: createdError } = await admin
        .from("income_register")
        .select("invoice_no")
        .eq("id", incomeId)
        .eq("tenant_id", requestRow.tenant_id)
        .maybeSingle();
      if (createdError) {
        throw new Error(createdError.message);
      }
      invoiceNo =
        (created?.invoice_no as string | null | undefined)?.trim() || invoiceNo;
    }

    if (slice > 0 && reference) {
      const { error: paymentError } = await admin.from("product_sale_payments").insert({
        tenant_id: requestRow.tenant_id,
        income_id: incomeId,
        payment_date: snapshot.saleDate,
        amount: slice,
        payment_method: method,
        notes: `Paystack ref: ${reference}`,
        recorded_by: null,
      });
      if (paymentError) {
        throw new Error(paymentError.message);
      }
    }

    incomeIds.push(incomeId);
    remaining = roundGhs(remaining - slice);
  }

  const recordedInvoice = invoiceNo || requestRow.invoice_no;
  if (remaining > 0 && reference) {
    await recordPaystackPaymentAttention(admin, {
      tenantId: requestRow.tenant_id,
      paymentRequestId: requestRow.id,
      reference,
      amount: remaining,
      customerLabel: snapshot.customerName || snapshot.clientId,
      clientId: snapshot.clientId,
      reason: paystackOverpaymentReason(remaining, recordedInvoice),
    });
  }

  const { error: markPaidError } = await admin
    .from("product_sale_payment_requests")
    .update({
      status: "paid",
      invoice_no: recordedInvoice,
      income_ids: incomeIds,
      paid_amount: collected,
      paid_at: options.paidAt,
      paystack_reference: reference ?? requestRow.paystack_reference,
      payment_method: method,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id)
    .eq("tenant_id", requestRow.tenant_id);
  if (markPaidError) {
    throw new Error(markPaidError.message);
  }

  if (!reference) {
    throw new Error(
      `Manual sale fulfillment ${requestRow.id}: missing Paystack reference — fee not posted.`,
    );
  }

  await postProductSalePaystackFee(admin, {
    tenantId: requestRow.tenant_id,
    reference,
    transactionAmountGhs: collected,
    paidAt: options.paidAt,
    flowLabel: "Manual product sale",
    invoiceNo: recordedInvoice,
    businessUnitId,
    incomeIds,
  });

  try {
    const { syncProductSaleVfrsTax } = await import(
      "@/utils/product-sale-tax-sync"
    );
    await syncProductSaleVfrsTax(admin, incomeIds);
  } catch {
    /* Sale is already posted. Tax sync is retried from the sales screen. */
  }

  return {
    invoiceNo: recordedInvoice,
    incomeIds,
    alreadyFulfilled: false,
    paymentMethod: method,
  };
}

/**
 * After Paystack success: create product sales from cart_snapshot (charge-first).
 * Shared by Instant MoMo Inline and Request Payment link.
 * Idempotent when status is already paid / income_ids already filled.
 */
export async function fulfillPosCartSnapshotPaymentRequest(
  admin: SupabaseClient,
  requestRow: PaymentRequestRow,
  options: {
    reference?: string | null;
    paidAmountGhs?: number | null;
    paidAt?: string | null;
    skipVerify?: boolean;
    /** Paystack channel (card, mobile_money, …) when known from verify/webhook. */
    paystackChannel?: string | null;
  } = {},
): Promise<{
  invoiceNo: string;
  incomeIds: string[];
  alreadyFulfilled: boolean;
  paymentMethod: string;
}> {
  if (requestRow.status === "paid") {
    const incomeIds = Array.isArray(requestRow.income_ids)
      ? requestRow.income_ids
      : [];
    const paidReference =
      (options.reference ?? requestRow.paystack_reference ?? "").trim() || null;
    if (paidReference && options.paidAmountGhs != null && options.paidAmountGhs > 0) {
      await postProductSalePaystackFee(admin, {
        tenantId: requestRow.tenant_id,
        reference: paidReference,
        transactionAmountGhs: roundGhs(options.paidAmountGhs),
        paidAt: options.paidAt ?? new Date().toISOString(),
        flowLabel: "POS product sale",
        invoiceNo: requestRow.invoice_no,
        incomeIds: requestRow.income_ids,
      });
    }
    return {
      invoiceNo: requestRow.invoice_no,
      incomeIds,
      alreadyFulfilled: true,
      paymentMethod: requestRow.payment_method || "POS",
    };
  }

  const existingIncomeIds = Array.isArray(requestRow.income_ids)
    ? requestRow.income_ids.filter(Boolean)
    : [];
  if (existingIncomeIds.length > 0) {
    const { error: markPaidError } = await admin
      .from("product_sale_payment_requests")
      .update({
        status: "paid",
        paid_amount:
          options.paidAmountGhs ?? roundGhs(Number(requestRow.amount_requested)),
        paid_at: options.paidAt ?? new Date().toISOString(),
        paystack_reference:
          options.reference ?? requestRow.paystack_reference,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestRow.id)
      .eq("tenant_id", requestRow.tenant_id);
    if (markPaidError) {
      throw new Error(markPaidError.message);
    }
    const paidReference =
      (options.reference ?? requestRow.paystack_reference ?? "").trim() || null;
    const paidAmount =
      options.paidAmountGhs ?? roundGhs(Number(requestRow.amount_requested));
    if (paidReference && paidAmount > 0) {
      await postProductSalePaystackFee(admin, {
        tenantId: requestRow.tenant_id,
        reference: paidReference,
        transactionAmountGhs: paidAmount,
        paidAt: options.paidAt ?? new Date().toISOString(),
        flowLabel: "POS product sale",
        invoiceNo: requestRow.invoice_no,
        incomeIds: existingIncomeIds,
      });
    }
    return {
      invoiceNo: requestRow.invoice_no,
      incomeIds: existingIncomeIds,
      alreadyFulfilled: true,
      paymentMethod: requestRow.payment_method || "POS",
    };
  }

  const snapshot = asCartSnapshot(requestRow.cart_snapshot);
  if (!snapshot) {
    throw new Error(
      `Payment request ${requestRow.id} has no cart_snapshot to fulfill.`,
    );
  }

  const reference =
    (options.reference ?? requestRow.paystack_reference ?? "").trim() || null;

  let verifiedChannel = options.paystackChannel ?? null;
  if (!options.skipVerify) {
    if (!reference) {
      throw new Error("Missing Paystack reference for cart-snapshot fulfillment.");
    }
    const verified = await verifyPaystackTransaction(reference);
    if (!verified.ok) {
      throw new Error(verified.error);
    }
    if (verified.status !== "success") {
      throw new Error(
        `Paystack status is "${verified.status}", expected success.`,
      );
    }
    if (!verifiedChannel && verified.channel) {
      verifiedChannel = verified.channel;
    }
  }

  // Re-read before creating sales so a concurrent confirm/webhook that already
  // finished is treated as idempotent (status paid / income_ids filled).
  const latestBeforeCreate = await loadPaymentRequestForFulfillment(admin, {
    paymentRequestId: requestRow.id,
  });
  if (latestBeforeCreate?.status === "paid") {
    return {
      invoiceNo: latestBeforeCreate.invoice_no,
      incomeIds: Array.isArray(latestBeforeCreate.income_ids)
        ? latestBeforeCreate.income_ids
        : [],
      alreadyFulfilled: true,
      paymentMethod: latestBeforeCreate.payment_method || "POS",
    };
  }
  const latestIncomeIds = Array.isArray(latestBeforeCreate?.income_ids)
    ? latestBeforeCreate.income_ids.filter(Boolean)
    : [];
  if (latestIncomeIds.length > 0) {
    return {
      invoiceNo: latestBeforeCreate!.invoice_no,
      incomeIds: latestIncomeIds,
      alreadyFulfilled: true,
      paymentMethod: latestBeforeCreate!.payment_method || "POS",
    };
  }

  const paymentMethod = paymentMethodFromPaystackChannel(
    verifiedChannel,
    requestRow.payment_method || POS_MOMO_PAYMENT_METHOD,
  );

  if (
    isManualSalePaystackSnapshot({
      incomeIds: requestRow.income_ids,
      invoiceNo: requestRow.invoice_no,
      snapshot,
    })
  ) {
    return fulfillManualSalePaymentRequest(admin, requestRow, snapshot, {
      reference,
      paidAmountGhs: options.paidAmountGhs,
      paidAt: options.paidAt ?? new Date().toISOString(),
      paymentMethod,
    });
  }

  const notes = buildPosNotes(paymentMethod, snapshot.notes);

  const paidAmount =
    options.paidAmountGhs != null && options.paidAmountGhs > 0
      ? roundGhs(options.paidAmountGhs)
      : cartSnapshotTotal(snapshot);

  const { data, error } = await admin.rpc("checkout_pos_cart", {
    p_tenant_id: requestRow.tenant_id,
    p_business_unit_id: snapshot.businessUnitId ?? null,
    p_sale_date: snapshot.saleDate,
    p_invoice_no:
      isProvisionalPosInvoiceNo(requestRow.invoice_no) ? null : requestRow.invoice_no,
    p_client_id: snapshot.clientId,
    p_customer_name: snapshot.clientId ? null : snapshot.customerName,
    p_payment_status: "Paid",
    p_due_date: snapshot.dueDate,
    p_notes: notes,
    p_payment_method: paymentMethod,
    p_sales_rep_id: null,
    p_amount_received: paidAmount,
    p_lines: snapshotLinesToCheckoutPayload(snapshot),
    p_payment_request_id: requestRow.id,
    p_paid_amount: paidAmount,
    p_paystack_reference: reference ?? requestRow.paystack_reference,
    p_paid_at: options.paidAt ?? new Date().toISOString(),
  });

  if (error) {
    throw new Error(error.message);
  }

  const checkout = data as {
    invoice_no?: string;
    income_ids?: string[];
    already_fulfilled?: boolean;
  } | null;

  const allocatedInvoiceNo = checkout?.invoice_no?.trim() || null;
  const incomeIds = (checkout?.income_ids ?? []).filter(Boolean);

  if (!allocatedInvoiceNo || incomeIds.length === 0) {
    throw new Error(
      "Could not resolve POS invoice number after cart-snapshot sale.",
    );
  }

  if (!reference) {
    throw new Error(
      `POS fulfillment ${requestRow.id}: missing Paystack reference — fee not posted.`,
    );
  }

  await postProductSalePaystackFee(admin, {
    tenantId: requestRow.tenant_id,
    reference,
    transactionAmountGhs: paidAmount,
    paidAt: options.paidAt ?? new Date().toISOString(),
    flowLabel: "POS product sale",
    invoiceNo: allocatedInvoiceNo,
    businessUnitId: snapshot.businessUnitId ?? null,
    incomeIds,
  });

  // Best-effort transactional customer notices (never block fulfillment).
  const customerId = snapshot.clientId?.trim() || null;
  const amountLabel = String(paidAmount);
  const productSummary = snapshot.lines
    .map((line) => `${line.productName} x${line.quantity}`)
    .join(", ");
  const customerName =
    snapshot.customerName?.trim() ||
    (customerId ? customerId : "Customer");

  void import("@/utils/transactional-notification-trigger").then(
    async ({ fireTransactionalNotification }) => {
      const { data: incomeScope } = await admin
        .from("income_register")
        .select("business_unit_id")
        .eq("tenant_id", requestRow.tenant_id)
        .in("id", incomeIds)
        .limit(1)
        .maybeSingle();
      const businessUnitId =
        (incomeScope?.business_unit_id as string | null | undefined)?.trim() ||
        null;

      void fireTransactionalNotification(
        requestRow.tenant_id,
        "sale_completed",
        customerId,
        {
          customer_name: customerName,
          invoice_no: allocatedInvoiceNo,
          amount: amountLabel,
          product_summary: productSummary,
        },
        { businessUnitId },
      );
      void fireTransactionalNotification(
        requestRow.tenant_id,
        "payment_received",
        customerId,
        {
          customer_name: customerName,
          amount: amountLabel,
          payment_reference: reference ?? requestRow.paystack_reference ?? "",
          invoice_no: allocatedInvoiceNo,
        },
        { businessUnitId },
      );
    },
  );

  void import("@/utils/tenant-admin-director-tier2-notifications").then(
    ({ notifyAdminsDirectorsLargeProductSaleWithLabel }) => {
      void notifyAdminsDirectorsLargeProductSaleWithLabel(
        requestRow.tenant_id,
        paidAmount,
        "Mobile Money checkout",
        "/dashboard/pos",
      );
    },
  );

  return {
    invoiceNo: allocatedInvoiceNo,
    incomeIds,
    alreadyFulfilled: false,
    paymentMethod,
  };
}

/** @deprecated Prefer fulfillPosCartSnapshotPaymentRequest — alias for Instant MoMo callers. */
export const fulfillPosMomoPaymentRequest = fulfillPosCartSnapshotPaymentRequest;

export async function loadPaymentRequestForFulfillment(
  admin: SupabaseClient,
  options: { paymentRequestId?: string | null; reference?: string | null },
): Promise<PaymentRequestRow | null> {
  let query = admin
    .from("product_sale_payment_requests")
    .select(
      "id, tenant_id, invoice_no, income_ids, paystack_reference, amount_requested, status, cart_snapshot, payment_method",
    );

  if (options.paymentRequestId && options.reference) {
    query = query
      .eq("id", options.paymentRequestId)
      .eq("paystack_reference", options.reference);
  } else if (options.paymentRequestId) {
    query = query.eq("id", options.paymentRequestId);
  } else if (options.reference) {
    query = query.eq("paystack_reference", options.reference);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  if (!data) {
    return null;
  }

  return {
    ...(data as PaymentRequestRow),
    cart_snapshot: asCartSnapshot(
      (data as { cart_snapshot?: unknown }).cart_snapshot,
    ),
  };
}
