import "server-only";

import { createAdminClient } from "@/utils/supabase/admin";
import { listPaystackTransactions } from "@/utils/paystack";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import { logSystemEvent } from "@/lib/system-event-log";

const RECONCILIATION_HOURS = 48;

type WebhookEventRow = {
  event_key: string;
  event_type: string;
  processing_status: string;
  payload: { data?: Record<string, unknown> } | null;
};

type ReconciliationIssue = {
  reference: string;
  kind: "missing_webhook" | "amount_mismatch" | "status_mismatch" | "subscription_missing";
  detail: string;
  paystackAmountPesewas?: number;
  paystackStatus?: string;
};

function metadataObject(raw: unknown): Record<string, unknown> {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function extractReferenceFromWebhook(row: WebhookEventRow): string | null {
  const fromPayload = row.payload?.data?.reference;
  if (typeof fromPayload === "string" && fromPayload.trim()) {
    return fromPayload.trim();
  }

  const suffix = row.event_key.split(":ref:")[1];
  if (suffix?.trim()) {
    return suffix.trim();
  }

  return null;
}

function isErpSubscriptionCharge(meta: Record<string, unknown>, data: Record<string, unknown>): boolean {
  return (
    Boolean(meta.tenant_id) ||
    Boolean(meta.product_id) ||
    Boolean(data.plan) ||
    Boolean(data.subscription)
  );
}

export type PaystackReconciliationResult = {
  windowStart: string;
  windowEnd: string;
  paystackTransactions: number;
  issues: ReconciliationIssue[];
};

export async function runPaystackReconciliation(): Promise<PaystackReconciliationResult> {
  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - RECONCILIATION_HOURS * 60 * 60 * 1000);

  const listResult = await listPaystackTransactions({
    from: windowStart.toISOString(),
    to: windowEnd.toISOString(),
    status: "success",
  });

  if (!listResult.ok) {
    throw new Error(listResult.error);
  }

  const admin = createAdminClient();

  const [{ data: webhookRows, error: webhookError }, { data: subscriptions, error: subError }] =
    await Promise.all([
      admin
        .from("paystack_webhook_events")
        .select("event_key, event_type, processing_status, payload")
        .eq("event_type", "charge.success"),
      admin
        .from("crm_subscriptions")
        .select("id, linked_tenant_id, subscription_status")
        .eq("tenant_id", DAVORS_TENANT_ID),
    ]);

  if (webhookError) {
    throw new Error(`paystack_webhook_events lookup failed: ${webhookError.message}`);
  }
  if (subError) {
    throw new Error(`crm_subscriptions lookup failed: ${subError.message}`);
  }

  const webhookByReference = new Map<string, WebhookEventRow>();
  for (const row of (webhookRows ?? []) as WebhookEventRow[]) {
    const reference = extractReferenceFromWebhook(row);
    if (reference) {
      webhookByReference.set(reference, row);
    }
  }

  const subscriptionByLinkedTenant = new Map<string, { id: string; subscription_status: string }>();
  for (const row of subscriptions ?? []) {
    const linkedTenantId = (row as { linked_tenant_id?: string | null }).linked_tenant_id;
    if (linkedTenantId) {
      subscriptionByLinkedTenant.set(linkedTenantId, {
        id: (row as { id: string }).id,
        subscription_status: (row as { subscription_status: string }).subscription_status,
      });
    }
  }

  const issues: ReconciliationIssue[] = [];

  for (const txn of listResult.transactions) {
    const reference = txn.reference.trim();
    if (!reference) {
      continue;
    }

    const webhook = webhookByReference.get(reference);
    if (!webhook || webhook.processing_status !== "processed") {
      issues.push({
        reference,
        kind: "missing_webhook",
        detail: webhook
          ? `Webhook exists but processing_status=${webhook.processing_status}`
          : "No matching processed webhook record",
        paystackAmountPesewas: txn.amountPesewas,
        paystackStatus: txn.status,
      });
      continue;
    }

    const dataObj = webhook.payload?.data ?? {};
    const webhookAmount =
      typeof dataObj.amount === "number" ? dataObj.amount : null;
    const webhookStatus =
      typeof dataObj.status === "string" ? dataObj.status.trim() : null;

    if (webhookAmount != null && webhookAmount !== txn.amountPesewas) {
      issues.push({
        reference,
        kind: "amount_mismatch",
        detail: `Paystack ${txn.amountPesewas} pesewas vs webhook ${webhookAmount} pesewas`,
        paystackAmountPesewas: txn.amountPesewas,
        paystackStatus: txn.status,
      });
    }

    if (webhookStatus && webhookStatus !== txn.status) {
      issues.push({
        reference,
        kind: "status_mismatch",
        detail: `Paystack status=${txn.status} vs webhook status=${webhookStatus}`,
        paystackAmountPesewas: txn.amountPesewas,
        paystackStatus: txn.status,
      });
    }

    const meta = metadataObject(dataObj.metadata);
    if (isErpSubscriptionCharge(meta, dataObj)) {
      const linkedTenantId =
        typeof meta.tenant_id === "string" ? meta.tenant_id.trim() : "";
      if (linkedTenantId && !subscriptionByLinkedTenant.has(linkedTenantId)) {
        issues.push({
          reference,
          kind: "subscription_missing",
          detail: `ERP subscription charge for tenant ${linkedTenantId} has no crm_subscriptions row`,
          paystackAmountPesewas: txn.amountPesewas,
          paystackStatus: txn.status,
        });
      }
    }
  }

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    paystackTransactions: listResult.transactions.length,
    issues,
  };
}

export async function runPaystackReconciliationWithLogging(): Promise<PaystackReconciliationResult> {
  try {
    const result = await runPaystackReconciliation();
    const failureIssues = result.issues.filter((issue) => issue.kind !== "subscription_missing");
    const warningIssues = result.issues.filter((issue) => issue.kind === "subscription_missing");

    if (failureIssues.length > 0) {
      await logSystemEvent({
        eventType: "payment",
        eventName: "paystack-reconciliation",
        status: "failure",
        message: `${failureIssues.length} reconciliation issue(s) across ${result.paystackTransactions} Paystack charge(s)`,
        metadata: {
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
          paystackTransactions: result.paystackTransactions,
          issues: result.issues,
        },
      });
    } else if (warningIssues.length > 0) {
      await logSystemEvent({
        eventType: "payment",
        eventName: "paystack-reconciliation",
        status: "warning",
        message: `${warningIssues.length} subscription warning(s); ${result.paystackTransactions} charge(s) otherwise reconciled`,
        metadata: {
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
          paystackTransactions: result.paystackTransactions,
          issues: result.issues,
        },
      });
    } else {
      await logSystemEvent({
        eventType: "payment",
        eventName: "paystack-reconciliation",
        status: "success",
        message: `Reconciled ${result.paystackTransactions} Paystack charge(s) — no issues`,
        metadata: {
          windowStart: result.windowStart,
          windowEnd: result.windowEnd,
          paystackTransactions: result.paystackTransactions,
        },
      });
    }

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Paystack reconciliation failed";
    await logSystemEvent({
      eventType: "payment",
      eventName: "paystack-reconciliation",
      status: "failure",
      message,
    });
    throw error;
  }
}
