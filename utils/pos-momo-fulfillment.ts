import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPosNotes,
  lineSubtotal,
  POS_MOMO_PAYMENT_METHOD,
  roundMoney,
  type PosCartLine,
} from "@/app/dashboard/pos/pos-utils";
import { verifyPaystackTransaction } from "@/utils/paystack";
import { roundGhs } from "@/utils/product-sale-paystack";
import { postProductSalePaystackFee } from "@/utils/paystack-finance-posting";
import { syncProductSaleVfrsTax } from "@/utils/product-sale-tax-sync";

export type PosCartSnapshot = {
  saleDate: string;
  clientId: string | null;
  customerName: string | null;
  notes: string | null;
  dueDate: string;
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
  cartLines: PosCartLine[];
}): PosCartSnapshot {
  return {
    saleDate: input.saleDate,
    clientId: input.clientId,
    customerName: input.customerName,
    notes: input.notes,
    dueDate: input.dueDate,
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

async function fetchIncomeInvoiceNumber(
  admin: SupabaseClient,
  incomeId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("income_register")
    .select("invoice_no")
    .eq("id", incomeId)
    .maybeSingle();
  if (error) {
    throw new Error(error.message);
  }
  const invoiceNo = (data as { invoice_no?: string | null } | null)?.invoice_no;
  return invoiceNo?.trim() ? invoiceNo.trim() : null;
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
  const notes = buildPosNotes(paymentMethod, snapshot.notes);
  const incomeIds: string[] = [];
  let allocatedInvoiceNo: string | null =
    isProvisionalPosInvoiceNo(requestRow.invoice_no)
      ? null
      : requestRow.invoice_no || null;

  for (const line of snapshot.lines) {
    const lineTotal = lineSubtotal(line);
    const { data, error } = await admin.rpc("create_product_sale", {
      p_date: snapshot.saleDate,
      p_invoice_no: allocatedInvoiceNo,
      p_client_id: snapshot.clientId,
      p_customer_name: snapshot.clientId ? null : snapshot.customerName,
      p_product_id: line.productId,
      p_quantity: line.quantity,
      p_unit_price: line.unitPrice,
      p_amount_received: lineTotal,
      p_payment_status: "Paid",
      p_due_date: snapshot.dueDate,
      p_description: null,
      p_notes: notes,
      p_invoice_entity_type: "POS",
    });

    if (error) {
      throw new Error(
        `create_product_sale failed for ${line.productCode}: ${error.message}`,
      );
    }

    const incomeId = typeof data === "string" ? data : null;
    if (!incomeId) {
      throw new Error(
        `create_product_sale returned no id for ${line.productCode}.`,
      );
    }
    incomeIds.push(incomeId);

    if (!allocatedInvoiceNo) {
      allocatedInvoiceNo = await fetchIncomeInvoiceNumber(admin, incomeId);
    }
  }

  if (!allocatedInvoiceNo) {
    throw new Error(
      "Could not resolve POS invoice number after cart-snapshot sale.",
    );
  }

  // VFRS output tax + tax ledger for the sales just created. Non-fatal: the
  // customer has already paid and the sales are posted, so a tax sync failure
  // must not fail the fulfillment (it would retrigger webhook retries).
  const { error: taxSyncError } = await syncProductSaleVfrsTax(
    admin,
    incomeIds,
  );
  if (taxSyncError) {
    console.error(
      `POS fulfillment ${requestRow.id}: VFRS tax sync failed: ${taxSyncError}`,
    );
  }

  const paidAmount =
    options.paidAmountGhs != null && options.paidAmountGhs > 0
      ? roundGhs(options.paidAmountGhs)
      : cartSnapshotTotal(snapshot);

  const { error: updateError } = await admin
    .from("product_sale_payment_requests")
    .update({
      status: "paid",
      invoice_no: allocatedInvoiceNo,
      income_ids: incomeIds,
      paid_amount: paidAmount,
      paid_at: options.paidAt ?? new Date().toISOString(),
      paystack_reference: reference ?? requestRow.paystack_reference,
      payment_method: paymentMethod,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id)
    .eq("tenant_id", requestRow.tenant_id);

  if (updateError) {
    throw new Error(updateError.message);
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

  if (options.paymentRequestId) {
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
