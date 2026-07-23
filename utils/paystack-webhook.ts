import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import {
  DAVORS_TENANT_ID,
  ERP_SUITE_CUSTOMER_STATUS,
  ERP_SUITE_CUSTOMER_TYPE,
  ERP_SUITE_SIGNUP_SOURCE,
  generateNextCustomerClientId,
  type CrmSubscriptionStatus,
} from "@/utils/tenant-signup";
import { ERP_SUITE_CATEGORY } from "@/app/dashboard/crm/products/products-utils";

type JsonRecord = Record<string, unknown>;

export type PaystackWebhookEnvelope = {
  event?: string;
  data?: JsonRecord;
};

export type WebhookProcessResult = {
  outcome: "processed" | "ignored" | "duplicate" | "error";
  eventKey: string;
  eventType: string;
  detail: string;
};

type SubscriptionRow = {
  id: string;
  linked_tenant_id: string | null;
  product_id: string | null;
  subscription_status: CrmSubscriptionStatus;
  billing_waived: boolean | null;
  paystack_customer_id: string | null;
  paystack_subscription_id: string | null;
  next_billing_date: string | null;
};

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

function toIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function addBillingCycle(
  fromIso: string,
  cycle: string | null,
): string | null {
  const base = new Date(`${fromIso}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) {
    return null;
  }

  const normalized = (cycle ?? "").toLowerCase();
  if (normalized === "yearly" || normalized === "annually" || normalized === "annual") {
    base.setUTCFullYear(base.getUTCFullYear() + 1);
    return base.toISOString().slice(0, 10);
  }

  // Default monthly (and unknown cycles treated as monthly for ERP Suite plans)
  base.setUTCMonth(base.getUTCMonth() + 1);
  return base.toISOString().slice(0, 10);
}

function metadataObject(data: JsonRecord): JsonRecord {
  const meta = asRecord(data.metadata);
  if (!meta) {
    return {};
  }

  // Paystack sometimes nests custom fields; flatten known keys from top-level meta.
  return meta;
}

function extractPlanCode(data: JsonRecord): string | null {
  const plan = data.plan;
  if (typeof plan === "string") {
    return asString(plan);
  }
  const planObj = asRecord(plan);
  return asString(planObj?.plan_code);
}

function extractCustomer(data: JsonRecord): {
  email: string | null;
  customerCode: string | null;
} {
  const customer = asRecord(data.customer);
  return {
    email: asString(customer?.email),
    customerCode: asString(customer?.customer_code),
  };
}

function extractSubscriptionCode(data: JsonRecord): string | null {
  const direct = asString(data.subscription_code);
  if (direct) {
    return direct;
  }
  const nested = asRecord(data.subscription);
  return asString(nested?.subscription_code);
}

function extractNextPaymentDate(data: JsonRecord): string | null {
  const direct = toIsoDate(asString(data.next_payment_date));
  if (direct) {
    return direct;
  }
  const nested = asRecord(data.subscription);
  return toIsoDate(asString(nested?.next_payment_date));
}

/** Durable key so Paystack retries are no-ops. */
export function buildPaystackWebhookEventKey(
  eventType: string,
  data: JsonRecord,
): string {
  const reference = asString(data.reference);
  const subscriptionCode = extractSubscriptionCode(data);
  const invoiceCode = asString(data.invoice_code);
  const numericId = asNumber(data.id);

  switch (eventType) {
    case "charge.success":
      if (reference) {
        return `charge.success:${reference}`;
      }
      break;
    case "subscription.create":
    case "subscription.disable":
      if (subscriptionCode) {
        return `${eventType}:${subscriptionCode}`;
      }
      break;
    case "invoice.payment_failed":
      if (invoiceCode) {
        return `invoice.payment_failed:${invoiceCode}`;
      }
      if (subscriptionCode && numericId != null) {
        return `invoice.payment_failed:${subscriptionCode}:${numericId}`;
      }
      break;
    default:
      break;
  }

  if (numericId != null) {
    return `${eventType}:id:${numericId}`;
  }
  if (reference) {
    return `${eventType}:ref:${reference}`;
  }
  if (subscriptionCode) {
    return `${eventType}:sub:${subscriptionCode}`;
  }

  // Last resort — still unique enough to avoid empty keys colliding.
  return `${eventType}:fallback:${Date.now()}`;
}

async function claimEventKey(options: {
  eventKey: string;
  eventType: string;
  payload: unknown;
}): Promise<"claimed" | "duplicate"> {
  const admin = createAdminClient();
  const { error } = await admin.from("paystack_webhook_events").insert({
    event_key: options.eventKey,
    event_type: options.eventType,
    processing_status: "processed",
    payload: options.payload,
  });

  if (!error) {
    return "claimed";
  }

  // Unique violation → already processed
  if (error.code === "23505") {
    return "duplicate";
  }

  throw new Error(`Failed to claim webhook event key: ${error.message}`);
}

async function markEventStatus(
  eventKey: string,
  status: "processed" | "ignored" | "error",
  errorMessage?: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("paystack_webhook_events")
    .update({
      processing_status: status,
      error_message: errorMessage ?? null,
    })
    .eq("event_key", eventKey);

  if (error) {
    console.error(
      `[paystack-webhook] Failed to update event ${eventKey} status=${status}:`,
      error.message,
    );
  }
}

async function findSubscriptionByLinkedTenant(
  linkedTenantId: string,
): Promise<SubscriptionRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, product_id, subscription_status, billing_waived, paystack_customer_id, paystack_subscription_id, next_billing_date",
    )
    .eq("linked_tenant_id", linkedTenantId)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SubscriptionRow | null) ?? null;
}

async function findSubscriptionByPaystackSubscriptionId(
  subscriptionCode: string,
): Promise<SubscriptionRow | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, product_id, subscription_status, billing_waived, paystack_customer_id, paystack_subscription_id, next_billing_date",
    )
    .eq("paystack_subscription_id", subscriptionCode)
    .eq("tenant_id", DAVORS_TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SubscriptionRow | null) ?? null;
}

async function findProductIdByPlanCode(planCode: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("crm_products")
    .select("id")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("category", ERP_SUITE_CATEGORY)
    .eq("paystack_plan_code", planCode)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id ?? null;
}

async function findSubscriptionByEmailAndPlan(options: {
  email: string;
  planCode: string | null;
}): Promise<SubscriptionRow | null> {
  const admin = createAdminClient();
  const email = options.email.toLowerCase();

  const { data: billingRows, error: billingError } = await admin
    .from("billing_settings")
    .select("tenant_id, email_recipient")
    .ilike("email_recipient", email);

  if (billingError) {
    throw new Error(billingError.message);
  }

  const tenantIds = (billingRows ?? [])
    .map((row) => asString(row.tenant_id))
    .filter((id): id is string => Boolean(id));

  if (tenantIds.length === 1) {
    return findSubscriptionByLinkedTenant(tenantIds[0]);
  }

  if (tenantIds.length > 1 && options.planCode) {
    const productId = await findProductIdByPlanCode(options.planCode);
    if (productId) {
      const { data, error } = await admin
        .from("crm_subscriptions")
        .select(
          "id, linked_tenant_id, product_id, subscription_status, billing_waived, paystack_customer_id, paystack_subscription_id, next_billing_date",
        )
        .eq("tenant_id", DAVORS_TENANT_ID)
        .eq("product_id", productId)
        .in("linked_tenant_id", tenantIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }
      if (data) {
        return data as SubscriptionRow;
      }
    }
  }

  // Fallback: customers.email under Davors tenant
  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("client_id")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .ilike("email", email)
    .limit(1)
    .maybeSingle();

  if (customerError) {
    throw new Error(customerError.message);
  }

  if (!customer?.client_id) {
    return null;
  }

  const { data: sub, error: subError } = await admin
    .from("crm_subscriptions")
    .select(
      "id, linked_tenant_id, product_id, subscription_status, billing_waived, paystack_customer_id, paystack_subscription_id, next_billing_date",
    )
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("customer_id", customer.client_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError) {
    throw new Error(subError.message);
  }

  return (sub as SubscriptionRow | null) ?? null;
}

async function resolveSubscription(options: {
  metadataTenantId: string | null;
  metadataProductId: string | null;
  subscriptionCode: string | null;
  customerCode: string | null;
  customerEmail: string | null;
  planCode: string | null;
}): Promise<SubscriptionRow | null> {
  if (options.metadataTenantId) {
    const byTenant = await findSubscriptionByLinkedTenant(options.metadataTenantId);
    if (byTenant) {
      return byTenant;
    }
  }

  if (options.subscriptionCode) {
    const bySub = await findSubscriptionByPaystackSubscriptionId(
      options.subscriptionCode,
    );
    if (bySub) {
      return bySub;
    }
  }

  if (options.customerCode) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("crm_subscriptions")
      .select(
        "id, linked_tenant_id, product_id, subscription_status, billing_waived, paystack_customer_id, paystack_subscription_id, next_billing_date",
      )
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("paystack_customer_id", options.customerCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }
    if (data) {
      return data as SubscriptionRow;
    }
  }

  if (options.customerEmail) {
    return findSubscriptionByEmailAndPlan({
      email: options.customerEmail,
      planCode: options.planCode,
    });
  }

  return null;
}

async function resolveNextBillingDate(options: {
  data: JsonRecord;
  productId: string | null;
  paidAt: string | null;
}): Promise<string | null> {
  const fromPayload = extractNextPaymentDate(options.data);
  if (fromPayload) {
    return fromPayload;
  }

  if (!options.productId || !options.paidAt) {
    return null;
  }

  const admin = createAdminClient();
  const { data: product, error } = await admin
    .from("crm_products")
    .select("billing_cycle")
    .eq("id", options.productId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const paidDate = toIsoDate(options.paidAt);
  if (!paidDate) {
    return null;
  }

  return addBillingCycle(paidDate, asString(product?.billing_cycle));
}

async function updateSubscription(
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("crm_subscriptions")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", DAVORS_TENANT_ID);

  if (error) {
    throw new Error(error.message);
  }
}

async function findDavorsCustomerId(options: {
  email: string | null;
  linkedTenantId: string;
}): Promise<string | null> {
  const admin = createAdminClient();

  // Prefer a customer already tied to this linked tenant via any prior subscription.
  const { data: priorSub, error: priorError } = await admin
    .from("crm_subscriptions")
    .select("customer_id")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .eq("linked_tenant_id", options.linkedTenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (priorError) {
    throw new Error(priorError.message);
  }
  if (priorSub?.customer_id) {
    return priorSub.customer_id;
  }

  if (options.email) {
    const { data: byEmail, error: emailError } = await admin
      .from("customers")
      .select("client_id")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .ilike("email", options.email)
      .limit(1)
      .maybeSingle();

    if (emailError) {
      throw new Error(emailError.message);
    }
    if (byEmail?.client_id) {
      return byEmail.client_id;
    }
  }

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("name")
    .eq("id", options.linkedTenantId)
    .maybeSingle();

  if (tenantError) {
    throw new Error(tenantError.message);
  }

  if (tenant?.name) {
    const { data: byName, error: nameError } = await admin
      .from("customers")
      .select("client_id")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .ilike("client_name", tenant.name)
      .limit(1)
      .maybeSingle();

    if (nameError) {
      throw new Error(nameError.message);
    }
    if (byName?.client_id) {
      return byName.client_id;
    }
  }

  return null;
}

async function createDavorsCustomerForTenant(options: {
  linkedTenantId: string;
  email: string | null;
}): Promise<string> {
  const admin = createAdminClient();

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select("name")
    .eq("id", options.linkedTenantId)
    .maybeSingle();

  if (tenantError) {
    throw new Error(tenantError.message);
  }
  if (!tenant) {
    throw new Error(
      `Cannot create crm_subscriptions — tenant ${options.linkedTenantId} does not exist.`,
    );
  }

  const { data: existingIds, error: idsError } = await admin
    .from("customers")
    .select("client_id")
    .eq("tenant_id", DAVORS_TENANT_ID);

  if (idsError) {
    throw new Error(idsError.message);
  }

  const clientId = generateNextCustomerClientId(
    (existingIds ?? []).map((row) => row.client_id).filter(Boolean),
  );

  const { error: insertError } = await admin.from("customers").insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: tenant.name,
    email: options.email,
    customer_type: ERP_SUITE_CUSTOMER_TYPE,
    source: ERP_SUITE_SIGNUP_SOURCE,
    status: ERP_SUITE_CUSTOMER_STATUS,
  });

  if (insertError) {
    throw new Error(insertError.message);
  }

  return clientId;
}

/**
 * Find Davors-scoped crm_subscriptions by linked_tenant_id, or INSERT one.
 * Signup normally creates this row; charge.success must not no-op when missing.
 */
async function ensureSubscriptionForLinkedTenant(options: {
  linkedTenantId: string;
  productId: string | null;
  customerEmail: string | null;
  customerCode: string | null;
  subscriptionCode: string | null;
  nextBillingDate: string | null;
  status: CrmSubscriptionStatus;
}): Promise<{ row: SubscriptionRow; created: boolean }> {
  const existing = await findSubscriptionByLinkedTenant(options.linkedTenantId);
  if (existing) {
    return { row: existing, created: false };
  }

  let customerId = await findDavorsCustomerId({
    email: options.customerEmail,
    linkedTenantId: options.linkedTenantId,
  });
  if (!customerId) {
    customerId = await createDavorsCustomerForTenant({
      linkedTenantId: options.linkedTenantId,
      email: options.customerEmail,
    });
  }

  const admin = createAdminClient();
  const insertPayload: Record<string, unknown> = {
    tenant_id: DAVORS_TENANT_ID,
    customer_id: customerId,
    linked_tenant_id: options.linkedTenantId,
    product_id: options.productId,
    subscription_status: options.status,
  };

  if (options.customerCode) {
    insertPayload.paystack_customer_id = options.customerCode;
  }
  if (options.subscriptionCode) {
    insertPayload.paystack_subscription_id = options.subscriptionCode;
  }
  if (options.nextBillingDate) {
    insertPayload.next_billing_date = options.nextBillingDate;
  }

  const { data, error } = await admin
    .from("crm_subscriptions")
    .insert(insertPayload)
    .select(
      "id, linked_tenant_id, product_id, subscription_status, billing_waived, paystack_customer_id, paystack_subscription_id, next_billing_date",
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to insert crm_subscriptions row.");
  }

  return { row: data as SubscriptionRow, created: true };
}

function warnIfWaived(row: SubscriptionRow, eventType: string): void {
  if (row.billing_waived === true) {
    console.warn(
      `[paystack-webhook] Conflict: ${eventType} for subscription ${row.id} ` +
        `(linked_tenant_id=${row.linked_tenant_id}) while billing_waived=true. ` +
        `Updating Paystack/status fields but leaving the waiver in place.`,
    );
  }
}

async function handleChargeSuccess(
  data: JsonRecord,
): Promise<{ detail: string; ignored?: boolean }> {
  const meta = metadataObject(data);
  const metadataTenantId = asString(meta.tenant_id);
  const metadataProductId = asString(meta.product_id);
  const planCode = extractPlanCode(data);
  const { email, customerCode } = extractCustomer(data);
  const subscriptionCode = extractSubscriptionCode(data);
  const reference = asString(data.reference);
  const paidAt = asString(data.paid_at) ?? asString(data.paidAt);

  // Only treat as ERP Suite subscription charge when we have plan and/or checkout metadata.
  if (!planCode && !metadataTenantId && !metadataProductId && !subscriptionCode) {
    return {
      ignored: true,
      detail: `charge.success ${reference ?? "(no ref)"} is not subscription-related — ignored.`,
    };
  }

  let productId = metadataProductId;
  if (!productId && planCode) {
    productId = await findProductIdByPlanCode(planCode);
  }

  const nextBillingDate = await resolveNextBillingDate({
    data,
    productId,
    paidAt,
  });

  let row = await resolveSubscription({
    metadataTenantId,
    metadataProductId,
    subscriptionCode,
    customerCode,
    customerEmail: email,
    planCode,
  });

  let created = false;

  if (!row) {
    if (!metadataTenantId) {
      return {
        ignored: true,
        detail: `charge.success ${reference ?? ""} — no matching crm_subscriptions row and no metadata.tenant_id to create one.`,
      };
    }

    const ensured = await ensureSubscriptionForLinkedTenant({
      linkedTenantId: metadataTenantId,
      productId,
      customerEmail: email,
      customerCode,
      subscriptionCode,
      nextBillingDate,
      status: "active",
    });
    row = ensured.row;
    created = ensured.created;
  }

  warnIfWaived(row, "charge.success");

  const patch: Record<string, unknown> = {
    subscription_status: "active" satisfies CrmSubscriptionStatus,
  };

  if (productId) {
    patch.product_id = productId;
  }
  if (nextBillingDate) {
    patch.next_billing_date = nextBillingDate;
  }
  if (customerCode) {
    patch.paystack_customer_id = customerCode;
  }
  if (subscriptionCode) {
    patch.paystack_subscription_id = subscriptionCode;
  }

  await updateSubscription(row.id, patch);

  return {
    detail: `charge.success ${created ? "created+activated" : "activated"} subscription ${row.id} (linked_tenant_id=${row.linked_tenant_id}, ref=${reference ?? "n/a"}, next_billing_date=${nextBillingDate ?? "unchanged"}).`,
  };
}

async function handleSubscriptionCreate(
  data: JsonRecord,
): Promise<{ detail: string; ignored?: boolean }> {
  const subscriptionCode = extractSubscriptionCode(data);
  if (!subscriptionCode) {
    return {
      ignored: true,
      detail: "subscription.create missing subscription_code — ignored.",
    };
  }

  const planCode = extractPlanCode(data);
  const { email, customerCode } = extractCustomer(data);
  const meta = metadataObject(data);
  const nextPaymentDate = extractNextPaymentDate(data);
  const metadataTenantId = asString(meta.tenant_id);
  let productId = asString(meta.product_id);
  if (!productId && planCode) {
    productId = await findProductIdByPlanCode(planCode);
  }

  let row = await resolveSubscription({
    metadataTenantId,
    metadataProductId: productId,
    subscriptionCode,
    customerCode,
    customerEmail: email,
    planCode,
  });

  let created = false;

  if (!row) {
    if (!metadataTenantId) {
      return {
        ignored: true,
        detail: `subscription.create ${subscriptionCode} — no matching crm_subscriptions row and no metadata.tenant_id to create one.`,
      };
    }

    const ensured = await ensureSubscriptionForLinkedTenant({
      linkedTenantId: metadataTenantId,
      productId,
      customerEmail: email,
      customerCode,
      subscriptionCode,
      nextBillingDate: nextPaymentDate,
      status: "active",
    });
    row = ensured.row;
    created = ensured.created;
  }

  warnIfWaived(row, "subscription.create");

  const patch: Record<string, unknown> = {
    paystack_subscription_id: subscriptionCode,
  };
  if (customerCode) {
    patch.paystack_customer_id = customerCode;
  }
  if (productId) {
    patch.product_id = productId;
  }
  if (nextPaymentDate) {
    patch.next_billing_date = nextPaymentDate;
  }
  // If we only had a trial row before, promote on subscription.create as well.
  if (row.subscription_status === "trialing" || created) {
    patch.subscription_status = "active" satisfies CrmSubscriptionStatus;
  }

  await updateSubscription(row.id, patch);

  return {
    detail: `subscription.create ${created ? "created and " : ""}stored paystack_subscription_id=${subscriptionCode} on ${row.id}.`,
  };
}

async function handleInvoicePaymentFailed(
  data: JsonRecord,
): Promise<{ detail: string; ignored?: boolean }> {
  const subscriptionCode = extractSubscriptionCode(data);
  const planCode = extractPlanCode(data);
  const { email, customerCode } = extractCustomer(data);
  const meta = metadataObject(data);

  const row = await resolveSubscription({
    metadataTenantId: asString(meta.tenant_id),
    metadataProductId: asString(meta.product_id),
    subscriptionCode,
    customerCode,
    customerEmail: email,
    planCode,
  });

  if (!row) {
    return {
      ignored: true,
      detail: "invoice.payment_failed — no matching crm_subscriptions row.",
    };
  }

  warnIfWaived(row, "invoice.payment_failed");

  // Flag only — trial-enforcement grants a grace period for past_due.
  await updateSubscription(row.id, {
    subscription_status: "past_due" satisfies CrmSubscriptionStatus,
  });

  return {
    detail: `invoice.payment_failed marked subscription ${row.id} as past_due (access retained until restricted/cancelled).`,
  };
}

async function handleSubscriptionDisable(
  data: JsonRecord,
): Promise<{ detail: string; ignored?: boolean }> {
  const subscriptionCode = extractSubscriptionCode(data);
  const planCode = extractPlanCode(data);
  const { email, customerCode } = extractCustomer(data);
  const meta = metadataObject(data);

  const row = await resolveSubscription({
    metadataTenantId: asString(meta.tenant_id),
    metadataProductId: asString(meta.product_id),
    subscriptionCode,
    customerCode,
    customerEmail: email,
    planCode,
  });

  if (!row) {
    return {
      ignored: true,
      detail: "subscription.disable — no matching crm_subscriptions row.",
    };
  }

  warnIfWaived(row, "subscription.disable");

  await updateSubscription(row.id, {
    subscription_status: "cancelled" satisfies CrmSubscriptionStatus,
  });

  return {
    detail: `subscription.disable marked subscription ${row.id} as cancelled.`,
  };
}

/**
 * Process a verified Paystack webhook envelope. Idempotent via
 * paystack_webhook_events.event_key.
 */
export async function processPaystackWebhookEvent(
  envelope: PaystackWebhookEnvelope,
): Promise<WebhookProcessResult> {
  const eventType = asString(envelope.event) ?? "unknown";
  const data = asRecord(envelope.data) ?? {};
  const eventKey = buildPaystackWebhookEventKey(eventType, data);

  const claim = await claimEventKey({
    eventKey,
    eventType,
    payload: envelope,
  });

  if (claim === "duplicate") {
    return {
      outcome: "duplicate",
      eventKey,
      eventType,
      detail: "Duplicate webhook delivery — already processed.",
    };
  }

  try {
    let result: { detail: string; ignored?: boolean };

    switch (eventType) {
      case "charge.success":
        result = await handleChargeSuccess(data);
        break;
      case "subscription.create":
        result = await handleSubscriptionCreate(data);
        break;
      case "invoice.payment_failed":
        result = await handleInvoicePaymentFailed(data);
        break;
      case "subscription.disable":
        result = await handleSubscriptionDisable(data);
        break;
      default:
        result = {
          ignored: true,
          detail: `Unhandled event type "${eventType}" — acknowledged.`,
        };
        break;
    }

    if (result.ignored) {
      await markEventStatus(eventKey, "ignored");
      return {
        outcome: "ignored",
        eventKey,
        eventType,
        detail: result.detail,
      };
    }

    await markEventStatus(eventKey, "processed");
    return {
      outcome: "processed",
      eventKey,
      eventType,
      detail: result.detail,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown webhook processing error";
    console.error(
      `[paystack-webhook] Processing failed for ${eventKey}:`,
      message,
      error,
    );
    await markEventStatus(eventKey, "error", message);
    return {
      outcome: "error",
      eventKey,
      eventType,
      detail: message,
    };
  }
}
