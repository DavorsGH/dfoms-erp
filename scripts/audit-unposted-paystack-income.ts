/**
 * Read-only audit: historical Paystack payments missing income_register posts.
 * Run: npx tsx scripts/audit-unposted-paystack-income.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";

const PAYSTACK_INCOME_INVOICE_PREFIX = "PSK-INC-";

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function roundGhs(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

async function loadPostedIncomeReferences(admin: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await admin
    .from("income_register")
    .select("invoice_no")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .like("invoice_no", `${PAYSTACK_INCOME_INVOICE_PREFIX}%`);

  if (error) {
    throw new Error(`income_register lookup failed: ${error.message}`);
  }

  const refs = new Set<string>();
  for (const row of data ?? []) {
    const invoiceNo = (row as { invoice_no?: string | null }).invoice_no?.trim();
    if (!invoiceNo?.startsWith(PAYSTACK_INCOME_INVOICE_PREFIX)) {
      continue;
    }
    refs.add(invoiceNo.slice(PAYSTACK_INCOME_INVOICE_PREFIX.length));
  }
  return refs;
}

async function auditSmsCredits(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("sms_credit_purchase_requests")
    .select("id, paystack_reference, paid_amount_ghs, amount_requested_ghs, status")
    .eq("status", "paid");

  if (error) {
    throw new Error(`sms_credit_purchase_requests lookup failed: ${error.message}`);
  }

  const posted = await loadPostedIncomeReferences(admin);
  const unposted: Array<{ reference: string; amountGhs: number }> = [];

  for (const row of data ?? []) {
    const reference = (row as { paystack_reference?: string | null })
      .paystack_reference?.trim();
    if (!reference) {
      continue;
    }
    if (posted.has(reference)) {
      continue;
    }
    const paidAmount = Number(
      (row as { paid_amount_ghs?: number | string | null }).paid_amount_ghs ??
        (row as { amount_requested_ghs?: number | string | null })
          .amount_requested_ghs,
    );
    unposted.push({
      reference,
      amountGhs: roundGhs(Number.isFinite(paidAmount) ? paidAmount : 0),
    });
  }

  const totalGhs = roundGhs(unposted.reduce((sum, row) => sum + row.amountGhs, 0));
  return { count: unposted.length, totalGhs, samples: unposted.slice(0, 5) };
}

async function auditUnitActivations(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("landlord_unit_activation_charges")
    .select("paystack_reference, amount_ghs, charge_status")
    .eq("charge_status", "success");

  if (error) {
    throw new Error(
      `landlord_unit_activation_charges lookup failed: ${error.message}`,
    );
  }

  const posted = await loadPostedIncomeReferences(admin);
  const unposted: Array<{ reference: string; amountGhs: number }> = [];

  for (const row of data ?? []) {
    const reference = (row as { paystack_reference?: string | null })
      .paystack_reference?.trim();
    if (!reference) {
      continue;
    }
    if (posted.has(reference)) {
      continue;
    }
    const amountGhs = roundGhs(Number((row as { amount_ghs?: number | string }).amount_ghs) || 0);
    unposted.push({ reference, amountGhs });
  }

  const totalGhs = roundGhs(unposted.reduce((sum, row) => sum + row.amountGhs, 0));
  return { count: unposted.length, totalGhs, samples: unposted.slice(0, 5) };
}

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

function isOtherPaystackContext(meta: Record<string, unknown>): boolean {
  const context = typeof meta.context === "string" ? meta.context.trim() : "";
  if (
    context === "product_sale" ||
    context === "rent_ledger" ||
    context === "sms_credit" ||
    context === "platform_only_unit_activation"
  ) {
    return false;
  }
  return true;
}

async function auditErpSubscriptions(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("paystack_webhook_events")
    .select("event_type, processing_status, payload")
    .eq("event_type", "charge.success")
    .in("processing_status", ["processed", "ignored"]);

  if (error) {
    throw new Error(`paystack_webhook_events lookup failed: ${error.message}`);
  }

  const posted = await loadPostedIncomeReferences(admin);
  const unposted: Array<{ reference: string; amountGhs: number }> = [];
  const seen = new Set<string>();

  for (const row of data ?? []) {
    const payload = (row as { payload?: unknown }).payload as
      | { data?: Record<string, unknown> }
      | null
      | undefined;
    const dataObj = payload?.data ?? {};
    const meta = metadataObject(dataObj.metadata);
    if (!isOtherPaystackContext(meta)) {
      continue;
    }

    const hasSubscriptionSignal =
      Boolean(meta.tenant_id) ||
      Boolean(meta.product_id) ||
      Boolean(dataObj.plan) ||
      Boolean(dataObj.subscription);
    if (!hasSubscriptionSignal) {
      continue;
    }

    const reference =
      typeof dataObj.reference === "string" ? dataObj.reference.trim() : "";
    if (!reference || seen.has(reference)) {
      continue;
    }
    seen.add(reference);

    if (posted.has(reference)) {
      continue;
    }

    const amountPesewas =
      typeof dataObj.amount === "number" ? dataObj.amount : null;
    if (amountPesewas == null) {
      continue;
    }

    unposted.push({
      reference,
      amountGhs: roundGhs(amountPesewas / 100),
    });
  }

  const totalGhs = roundGhs(unposted.reduce((sum, row) => sum + row.amountGhs, 0));
  return { count: unposted.length, totalGhs, samples: unposted.slice(0, 5) };
}

async function main() {
  const admin = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const [sms, units, erp] = await Promise.all([
    auditSmsCredits(admin),
    auditUnitActivations(admin),
    auditErpSubscriptions(admin),
  ]);

  console.log("=== Unposted Paystack income_register audit (DAVORS tenant) ===");
  console.log(`Income invoice prefix: ${PAYSTACK_INCOME_INVOICE_PREFIX}`);
  console.log(`Example invoice_no: ${PAYSTACK_INCOME_INVOICE_PREFIX}sample-ref`);
  console.log("");
  console.log("1. SMS credit purchases (status=paid, no PSK-INC income row)");
  console.log(`   Count: ${sms.count}`);
  console.log(`   Total GHS: ${sms.totalGhs.toFixed(2)}`);
  if (sms.samples.length > 0) {
    console.log("   Samples:", sms.samples);
  }
  console.log("");
  console.log("2. Platform unit activations (charge_status=success, no PSK-INC income row)");
  console.log(`   Count: ${units.count}`);
  console.log(`   Total GHS: ${units.totalGhs.toFixed(2)}`);
  if (units.samples.length > 0) {
    console.log("   Samples:", units.samples);
  }
  console.log("");
  console.log(
    "3. ERP Suite subscription charge.success webhooks (non-product/rent/sms/unit contexts, no PSK-INC income row)",
  );
  console.log(`   Count: ${erp.count}`);
  console.log(`   Total GHS: ${erp.totalGhs.toFixed(2)}`);
  if (erp.samples.length > 0) {
    console.log("   Samples:", erp.samples);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
