import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { roundGhs } from "@/utils/product-sale-paystack";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";

/** Paystack Ghana transaction fee rate applied platform-wide. */
export const PAYSTACK_TRANSACTION_FEE_RATE = 0.0195;

export const PAYSTACK_INCOME_INVOICE_PREFIX = "PSK-INC-";
export const PAYSTACK_FEE_RECEIPT_PREFIX = "PSK-FEE-";
export const PAYSTACK_PROPERTY_FEE_MARKER_PREFIX = "[paystack-fee:";

export const ERP_SUITE_SUBSCRIPTION_INCOME_CATEGORY = "ERP Suite";
export const PLATFORM_BILLING_INCOME_CATEGORY = "Platform Billing";

export const PAYSTACK_FEE_EXPENSE_CATEGORY = "Direct Operational";
export const PAYSTACK_FEE_EXPENSE_SUB_CATEGORY = "Paystack Transaction Fees";
export const PAYSTACK_FEE_PROPERTY_CATEGORY = "Paystack Transaction Fee";

export const PAYSTACK_FEE_VENDOR = "Paystack";
export const PAYSTACK_FEE_PAYMENT_METHOD = "Paystack";
export const PAYSTACK_FEE_APPROVED_BY = "System";

export function calculatePaystackTransactionFeeGhs(
  transactionAmountGhs: number,
): number {
  const amount = roundGhs(transactionAmountGhs);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `Paystack transaction amount must be a positive number (got ${transactionAmountGhs}).`,
    );
  }
  return roundGhs(amount * PAYSTACK_TRANSACTION_FEE_RATE);
}

export function paystackIncomeInvoiceNo(reference: string): string {
  const ref = reference.trim();
  if (!ref) {
    throw new Error("Missing Paystack reference for income_register invoice_no.");
  }
  return `${PAYSTACK_INCOME_INVOICE_PREFIX}${ref}`;
}

export function paystackFeeReceiptNo(reference: string): string {
  const ref = reference.trim();
  if (!ref) {
    throw new Error("Missing Paystack reference for expense_register receipt_no.");
  }
  return `${PAYSTACK_FEE_RECEIPT_PREFIX}${ref}`;
}

export function paystackPropertyFeeMarker(reference: string): string {
  const ref = reference.trim();
  if (!ref) {
    throw new Error("Missing Paystack reference for property_expenses marker.");
  }
  return `${PAYSTACK_PROPERTY_FEE_MARKER_PREFIX}${ref}]`;
}

export function resolvePaystackPaymentDate(
  paidAt: string | null | undefined,
): string {
  if (paidAt?.trim()) {
    const trimmed = paidAt.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
      return trimmed.slice(0, 10);
    }
  }
  return new Date().toISOString().slice(0, 10);
}

export function assertVerifiedPaystackAmountGhs(options: {
  paidAmountGhs: number | null | undefined;
  reference: string;
  context: string;
}): number {
  const amount = roundGhs(Number(options.paidAmountGhs));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(
      `${options.context}: verified Paystack amount is missing or invalid for reference ${options.reference}.`,
    );
  }
  return amount;
}

type IncomePostOptions = {
  tenantId: string;
  reference: string;
  transactionAmountGhs: number;
  paidAt: string | null | undefined;
  serviceCategory: string;
  description: string;
  customerName: string | null;
  notes: string;
};

type ExpenseFeePostOptions = {
  tenantId: string;
  reference: string;
  transactionAmountGhs: number;
  paidAt: string | null | undefined;
  description: string;
  notes: string;
};

type PropertyFeePostOptions = {
  landlordTenantId: string;
  propertyId: string;
  reference: string;
  transactionAmountGhs: number;
  paidAt: string | null | undefined;
  description: string;
};

async function incomeAlreadyPosted(
  admin: SupabaseClient,
  tenantId: string,
  invoiceNo: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("income_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("invoice_no", invoiceNo)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[paystack-finance] Failed checking income_register duplicate (${invoiceNo}): ${error.message}`,
    );
  }

  return Boolean(data?.id);
}

async function expenseFeeAlreadyPosted(
  admin: SupabaseClient,
  tenantId: string,
  receiptNo: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("expense_register")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("receipt_no", receiptNo)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[paystack-finance] Failed checking expense_register duplicate (${receiptNo}): ${error.message}`,
    );
  }

  return Boolean(data?.id);
}

async function propertyFeeAlreadyPosted(
  admin: SupabaseClient,
  landlordTenantId: string,
  marker: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("property_expenses")
    .select("expense_id")
    .eq("tenant_id", landlordTenantId)
    .ilike("description", `%${marker}%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[paystack-finance] Failed checking property_expenses duplicate (${marker}): ${error.message}`,
    );
  }

  return Boolean(data?.expense_id);
}

/**
 * Insert a paid income_register row for a verified Paystack charge.
 * Idempotent via deterministic invoice_no (PSK-INC-{reference}).
 */
export async function postPaystackIncomeRegisterEntry(
  admin: SupabaseClient,
  options: IncomePostOptions,
): Promise<"inserted" | "already_posted"> {
  const reference = options.reference.trim();
  const transactionAmountGhs = roundGhs(options.transactionAmountGhs);
  if (!reference) {
    throw new Error("[paystack-finance] Missing Paystack reference for income post.");
  }
  if (!Number.isFinite(transactionAmountGhs) || transactionAmountGhs <= 0) {
    throw new Error(
      `[paystack-finance] Invalid transaction amount ${transactionAmountGhs} for income post (ref=${reference}).`,
    );
  }

  const invoiceNo = paystackIncomeInvoiceNo(reference);
  if (await incomeAlreadyPosted(admin, options.tenantId, invoiceNo)) {
    return "already_posted";
  }

  const paymentDate = resolvePaystackPaymentDate(options.paidAt);
  const { error: insertError } = await admin.from("income_register").insert({
    tenant_id: options.tenantId,
    date: paymentDate,
    due_date: paymentDate,
    invoice_no: invoiceNo,
    customer_name: options.customerName,
    client_id: null,
    entry_type: "service",
    service_category: options.serviceCategory,
    description: options.description,
    amount: transactionAmountGhs,
    amount_received: transactionAmountGhs,
    outstanding_balance: 0,
    payment_status: "Paid",
    notes: options.notes,
    tax_inclusive: true,
    net_of_tax_amount: transactionAmountGhs,
    output_vat_amount: 0,
    output_tax_component: null,
    wht_rate: null,
    wht_amount: 0,
    sale_status: "active",
    is_system_adjustment: false,
  });

  if (insertError) {
    throw new Error(
      `[paystack-finance] Failed posting income_register for Paystack ref ${reference}: ${insertError.message}`,
    );
  }

  return "inserted";
}

/**
 * Insert a paid expense_register row for the Paystack transaction fee (1.95%).
 * Idempotent via deterministic receipt_no (PSK-FEE-{reference}).
 */
export async function postPaystackFeeToExpenseRegister(
  admin: SupabaseClient,
  options: ExpenseFeePostOptions,
): Promise<"inserted" | "already_posted"> {
  const reference = options.reference.trim();
  if (!reference) {
    throw new Error("[paystack-finance] Missing Paystack reference for fee post.");
  }

  const transactionAmountGhs = roundGhs(options.transactionAmountGhs);
  const feeAmountGhs = calculatePaystackTransactionFeeGhs(transactionAmountGhs);
  const receiptNo = paystackFeeReceiptNo(reference);

  if (await expenseFeeAlreadyPosted(admin, options.tenantId, receiptNo)) {
    return "already_posted";
  }

  const paymentDate = resolvePaystackPaymentDate(options.paidAt);
  const { error: insertError } = await admin.from("expense_register").insert({
    tenant_id: options.tenantId,
    date: paymentDate,
    expense_category: PAYSTACK_FEE_EXPENSE_CATEGORY,
    sub_category: PAYSTACK_FEE_EXPENSE_SUB_CATEGORY,
    description: options.description,
    vendor: PAYSTACK_FEE_VENDOR,
    price: feeAmountGhs,
    quantity: 1,
    amount: feeAmountGhs,
    payment_method: PAYSTACK_FEE_PAYMENT_METHOD,
    approved_by: PAYSTACK_FEE_APPROVED_BY,
    receipt_no: receiptNo,
    payment_status: "Paid",
    notes: options.notes,
  });

  if (insertError) {
    throw new Error(
      `[paystack-finance] Failed posting expense_register Paystack fee for ref ${reference}: ${insertError.message}`,
    );
  }

  return "inserted";
}

/**
 * platform_only rent: fee settles against the landlord's Paystack subaccount.
 * Post to property_expenses (Real Estate Finance), not Davors expense_register.
 */
export async function postPaystackFeeToPropertyExpenses(
  admin: SupabaseClient,
  options: PropertyFeePostOptions,
): Promise<"inserted" | "already_posted"> {
  const reference = options.reference.trim();
  if (!reference) {
    throw new Error(
      "[paystack-finance] Missing Paystack reference for property fee post.",
    );
  }

  const transactionAmountGhs = roundGhs(options.transactionAmountGhs);
  const feeAmountGhs = calculatePaystackTransactionFeeGhs(transactionAmountGhs);
  const marker = paystackPropertyFeeMarker(reference);

  if (
    await propertyFeeAlreadyPosted(
      admin,
      options.landlordTenantId,
      marker,
    )
  ) {
    return "already_posted";
  }

  const paymentDate = resolvePaystackPaymentDate(options.paidAt);
  const nowIso = new Date().toISOString();
  const description = `${options.description} ${marker}`;

  const { error: insertError } = await admin.from("property_expenses").insert({
    tenant_id: options.landlordTenantId,
    expense_id: crypto.randomUUID(),
    property_id: options.propertyId,
    category: PAYSTACK_FEE_PROPERTY_CATEGORY,
    amount_ghs: feeAmountGhs,
    expense_date: paymentDate,
    description,
    receipt_url: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    throw new Error(
      `[paystack-finance] Failed posting property_expenses Paystack fee for ref ${reference}: ${insertError.message}`,
    );
  }

  return "inserted";
}

async function resolveTenantDisplayName(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data, error } = await admin
    .from("tenants")
    .select("name")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `[paystack-finance] Failed resolving tenant name (${tenantId}): ${error.message}`,
    );
  }

  return data?.name?.trim() || tenantId;
}

async function resolveProductDisplayName(
  admin: SupabaseClient,
  productId: string | null,
): Promise<string | null> {
  if (!productId?.trim()) {
    return null;
  }

  const { data, error } = await admin
    .from("crm_products")
    .select("name")
    .eq("id", productId.trim())
    .maybeSingle();

  if (error) {
    throw new Error(
      `[paystack-finance] Failed resolving product name (${productId}): ${error.message}`,
    );
  }

  return data?.name?.trim() || null;
}

export async function postErpSubscriptionPaystackFinance(
  admin: SupabaseClient,
  options: {
    reference: string;
    transactionAmountGhs: number;
    paidAt: string | null | undefined;
    linkedTenantId: string | null;
    productId: string | null;
    subscriptionId: string;
  },
): Promise<void> {
  const reference = options.reference.trim();
  const transactionAmountGhs = assertVerifiedPaystackAmountGhs({
    paidAmountGhs: options.transactionAmountGhs,
    reference,
    context: "ERP Suite subscription",
  });

  const [customerName, productName] = await Promise.all([
    options.linkedTenantId
      ? resolveTenantDisplayName(admin, options.linkedTenantId)
      : Promise.resolve("Unknown tenant"),
    resolveProductDisplayName(admin, options.productId),
  ]);

  const tierLabel = productName ?? "ERP Suite tier";
  const description = `ERP Suite subscription — ${tierLabel} — ${customerName}`;
  const notes = [
    `Auto-posted from Paystack charge.success.`,
    `paystack_reference=${reference}`,
    `crm_subscription_id=${options.subscriptionId}`,
    options.linkedTenantId
      ? `linked_tenant_id=${options.linkedTenantId}`
      : null,
    options.productId ? `product_id=${options.productId}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  await postPaystackIncomeRegisterEntry(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    serviceCategory: ERP_SUITE_SUBSCRIPTION_INCOME_CATEGORY,
    description,
    customerName,
    notes,
  });

  await postPaystackFeeToExpenseRegister(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    description: `Paystack transaction fee — ERP Suite subscription (${reference})`,
    notes: `Transaction amount GHS ${transactionAmountGhs.toFixed(2)}; fee rate ${(PAYSTACK_TRANSACTION_FEE_RATE * 100).toFixed(2)}%. paystack_reference=${reference}`,
  });
}

export async function postSmsCreditPurchasePaystackFinance(
  admin: SupabaseClient,
  options: {
    reference: string;
    transactionAmountGhs: number;
    paidAt: string | null | undefined;
    purchasingTenantId: string;
    purchaseRequestId: string;
    packKey: string;
    credits: number;
  },
): Promise<void> {
  const reference = options.reference.trim();
  const transactionAmountGhs = assertVerifiedPaystackAmountGhs({
    paidAmountGhs: options.transactionAmountGhs,
    reference,
    context: "SMS credit purchase",
  });

  const customerName = await resolveTenantDisplayName(
    admin,
    options.purchasingTenantId,
  );
  const description = `SMS credit purchase — ${options.credits} credits (${options.packKey}) — ${customerName}`;
  const notes = [
    `Auto-posted from Paystack SMS credit purchase.`,
    `paystack_reference=${reference}`,
    `purchase_request_id=${options.purchaseRequestId}`,
    `purchasing_tenant_id=${options.purchasingTenantId}`,
    `pack_key=${options.packKey}`,
    `credits=${options.credits}`,
  ].join(" ");

  await postPaystackIncomeRegisterEntry(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    serviceCategory: PLATFORM_BILLING_INCOME_CATEGORY,
    description,
    customerName,
    notes,
  });

  await postPaystackFeeToExpenseRegister(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    description: `Paystack transaction fee — SMS credit purchase (${reference})`,
    notes: `Transaction amount GHS ${transactionAmountGhs.toFixed(2)}; fee rate ${(PAYSTACK_TRANSACTION_FEE_RATE * 100).toFixed(2)}%. paystack_reference=${reference}`,
  });
}

export async function postPlatformUnitActivationPaystackFinance(
  admin: SupabaseClient,
  options: {
    reference: string;
    transactionAmountGhs: number;
    paidAt: string | null | undefined;
    landlordTenantId: string;
    unitId: string;
    unitNumber: string;
    triggerType?: string | null;
  },
): Promise<void> {
  const reference = options.reference.trim();
  const transactionAmountGhs = assertVerifiedPaystackAmountGhs({
    paidAmountGhs: options.transactionAmountGhs,
    reference,
    context: "Platform unit activation",
  });

  const customerName = await resolveTenantDisplayName(
    admin,
    options.landlordTenantId,
  );
  const description = `Platform-only unit activation — Unit ${options.unitNumber} — ${customerName}`;
  const notes = [
    `Auto-posted from Paystack platform_only unit activation.`,
    `paystack_reference=${reference}`,
    `landlord_tenant_id=${options.landlordTenantId}`,
    `unit_id=${options.unitId}`,
    options.triggerType ? `trigger_type=${options.triggerType}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  await postPaystackIncomeRegisterEntry(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    serviceCategory: PLATFORM_BILLING_INCOME_CATEGORY,
    description,
    customerName,
    notes,
  });

  await postPaystackFeeToExpenseRegister(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    description: `Paystack transaction fee — platform unit activation (${reference})`,
    notes: `Transaction amount GHS ${transactionAmountGhs.toFixed(2)}; fee rate ${(PAYSTACK_TRANSACTION_FEE_RATE * 100).toFixed(2)}%. paystack_reference=${reference}`,
  });
}

export async function postPlatformMonthlyUnitBillingPaystackFinance(
  admin: SupabaseClient,
  options: {
    reference: string;
    transactionAmountGhs: number;
    paidAt: string | null | undefined;
    landlordTenantId: string;
    activeUnitCount: number;
    unitPriceGhs: number;
    billingMonth: string;
  },
): Promise<void> {
  const reference = options.reference.trim();
  const transactionAmountGhs = assertVerifiedPaystackAmountGhs({
    paidAmountGhs: options.transactionAmountGhs,
    reference,
    context: "Platform monthly unit billing",
  });

  const customerName = await resolveTenantDisplayName(
    admin,
    options.landlordTenantId,
  );
  const description = `Platform-only monthly unit billing — ${options.activeUnitCount} unit(s) × GHS ${options.unitPriceGhs.toFixed(2)} — ${customerName}`;
  const notes = [
    `Auto-posted from Paystack platform_only monthly unit billing.`,
    `paystack_reference=${reference}`,
    `landlord_tenant_id=${options.landlordTenantId}`,
    `billing_month=${options.billingMonth}`,
    `active_unit_count=${options.activeUnitCount}`,
    `unit_price_ghs=${options.unitPriceGhs.toFixed(2)}`,
    `trigger_type=monthly_recurring`,
  ].join(" ");

  await postPaystackIncomeRegisterEntry(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    serviceCategory: PLATFORM_BILLING_INCOME_CATEGORY,
    description,
    customerName,
    notes,
  });

  await postPaystackFeeToExpenseRegister(admin, {
    tenantId: DAVORS_TENANT_ID,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    description: `Paystack transaction fee — platform monthly unit billing (${reference})`,
    notes: `Transaction amount GHS ${transactionAmountGhs.toFixed(2)}; fee rate ${(PAYSTACK_TRANSACTION_FEE_RATE * 100).toFixed(2)}%. paystack_reference=${reference}`,
  });
}

export async function postProductSalePaystackFee(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    reference: string;
    transactionAmountGhs: number;
    paidAt: string | null | undefined;
    flowLabel: string;
    invoiceNo?: string | null;
  },
): Promise<void> {
  const reference = options.reference.trim();
  const transactionAmountGhs = assertVerifiedPaystackAmountGhs({
    paidAmountGhs: options.transactionAmountGhs,
    reference,
    context: options.flowLabel,
  });

  const invoicePart = options.invoiceNo?.trim()
    ? ` invoice ${options.invoiceNo.trim()}`
    : "";
  await postPaystackFeeToExpenseRegister(admin, {
    tenantId: options.tenantId,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    description: `Paystack transaction fee — ${options.flowLabel}${invoicePart} (${reference})`,
    notes: [
      `Auto-posted Paystack settlement fee for ${options.flowLabel}.`,
      `paystack_reference=${reference}`,
      options.invoiceNo?.trim() ? `invoice_no=${options.invoiceNo.trim()}` : null,
      `transaction_amount_ghs=${transactionAmountGhs.toFixed(2)}`,
      `fee_rate=${(PAYSTACK_TRANSACTION_FEE_RATE * 100).toFixed(2)}%`,
    ]
      .filter(Boolean)
      .join(" "),
  });
}

export async function postRentPaystackFee(
  admin: SupabaseClient,
  options: {
    landlordTenantId: string;
    landlordType: "davors_managed" | "platform_only";
    leaseId: string;
    reference: string;
    transactionAmountGhs: number;
    paidAt: string | null | undefined;
  },
): Promise<void> {
  const reference = options.reference.trim();
  const transactionAmountGhs = assertVerifiedPaystackAmountGhs({
    paidAmountGhs: options.transactionAmountGhs,
    reference,
    context: "Rent payment",
  });

  const descriptionBase = `Paystack transaction fee — tenant rent payment (${reference})`;

  if (options.landlordType === "davors_managed") {
    await postPaystackFeeToExpenseRegister(admin, {
      tenantId: DAVORS_TENANT_ID,
      reference,
      transactionAmountGhs,
      paidAt: options.paidAt,
      description: descriptionBase,
      notes: [
        `Auto-posted Paystack settlement fee on full rent amount (davors_managed).`,
        `paystack_reference=${reference}`,
        `landlord_tenant_id=${options.landlordTenantId}`,
        `lease_id=${options.leaseId}`,
        `transaction_amount_ghs=${transactionAmountGhs.toFixed(2)}`,
        `fee_rate=${(PAYSTACK_TRANSACTION_FEE_RATE * 100).toFixed(2)}%`,
      ].join(" "),
    });
    return;
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("property_id")
    .eq("tenant_id", options.landlordTenantId)
    .eq("lease_id", options.leaseId)
    .maybeSingle();

  if (leaseError) {
    throw new Error(
      `[paystack-finance] Failed resolving property for platform_only rent fee (lease ${options.leaseId}): ${leaseError.message}`,
    );
  }

  const propertyId =
    typeof lease?.property_id === "string" ? lease.property_id.trim() : "";
  if (!propertyId) {
    throw new Error(
      `[paystack-finance] Cannot post platform_only Paystack rent fee: lease ${options.leaseId} has no property_id.`,
    );
  }

  await postPaystackFeeToPropertyExpenses(admin, {
    landlordTenantId: options.landlordTenantId,
    propertyId,
    reference,
    transactionAmountGhs,
    paidAt: options.paidAt,
    description: descriptionBase,
  });
}
