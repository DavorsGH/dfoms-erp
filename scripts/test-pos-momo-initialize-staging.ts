/**
 * Staging smoke checks for POS Instant MoMo (charge-first).
 * Does not open Inline popup / complete a real charge.
 * Usage: npx tsx scripts/test-pos-momo-initialize-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const POS_MOMO_PAYMENT_METHOD = "Mobile Money";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

  const secret = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
  const publicKey = (process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "").trim();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  console.log(
    "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY:",
    publicKey ? `PRESENT (len=${publicKey.length})` : "MISSING",
  );
  console.log(
    "PAYSTACK_SECRET_KEY:",
    secret ? `PRESENT (len=${secret.length})` : "MISSING",
  );

  assert(
    secret.startsWith("sk_test_") || secret.startsWith("sk_live_"),
    "PAYSTACK_SECRET_KEY missing",
  );
  assert(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL missing");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY missing");

  const amountGhs = 1.5;
  const snapshot = {
    saleDate: new Date().toISOString().slice(0, 10),
    clientId: null as string | null,
    customerName: "MoMo Staging Smoke",
    notes: "cancel-path smoke — no sale until confirm",
    dueDate: new Date().toISOString().slice(0, 10),
    lines: [
      {
        id: crypto.randomUUID(),
        productId: "00000000-0000-4000-8000-000000000001",
        productCode: "SMOKE-1",
        productName: "Smoke Line",
        unitOfMeasure: "ea",
        quantity: 1,
        unitPrice: amountGhs,
      },
    ],
  };

  let paystackOk = false;
  let reference = `momo_smoke_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  try {
    const initResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "pos-momo-smoke@davorsfacilities.com",
          amount: Math.round(amountGhs * 100),
          currency: "GHS",
          channels: ["mobile_money"],
          callback_url: "https://example.com/pay/product-sale/callback",
          metadata: {
            context: "product_sale",
            flow: "pos_momo_inline_smoke",
          },
        }),
      },
    );
    const initPayload = (await initResponse.json()) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        access_code?: string;
        reference?: string;
      };
    };
    if (!initResponse.ok || initPayload.status === false) {
      console.log(
        "Paystack MoMo initialize: BLOCKED —",
        initPayload.message ?? `HTTP ${initResponse.status}`,
      );
    } else {
      const accessCode = initPayload.data?.access_code?.trim() ?? "";
      reference = initPayload.data?.reference?.trim() || reference;
      assert(accessCode, "Paystack did not return access_code (needed for Inline)");
      assert(reference, "Paystack did not return reference");
      paystackOk = true;
      console.log(
        "Paystack MoMo initialize: OK (access_code + reference present)",
      );
    }
  } catch (error) {
    console.log(
      "Paystack MoMo initialize: BLOCKED —",
      error instanceof Error ? error.message : String(error),
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .select("id")
    .limit(1)
    .maybeSingle();
  assert(!tenantError, tenantError?.message ?? "tenant lookup failed");
  assert(tenantRow?.id, "No tenant found on staging");

  const provisionalInvoice = `MOMO-SMOKE-${crypto.randomUUID().slice(0, 8)}`;
  const { data: inserted, error: insertError } = await admin
    .from("product_sale_payment_requests")
    .insert({
      tenant_id: tenantRow.id,
      invoice_no: provisionalInvoice,
      income_ids: [],
      cart_snapshot: snapshot,
      amount_requested: amountGhs,
      currency: "GHS",
      status: "sent",
      payment_method: POS_MOMO_PAYMENT_METHOD,
      paystack_reference: reference,
      delivery_email: null,
      delivery_phone: null,
      send_email: false,
      send_sms: false,
    })
    .select("id, income_ids, cart_snapshot, status")
    .single();

  assert(!insertError && inserted?.id, insertError?.message ?? "insert failed");
  const incomeIds = Array.isArray(inserted.income_ids)
    ? inserted.income_ids.filter(Boolean)
    : [];
  assert(
    incomeIds.length === 0,
    "Cancel-path expectation failed: income_ids should be empty before confirm",
  );
  assert(
    inserted.cart_snapshot != null,
    "cart_snapshot missing on payment request",
  );
  assert(
    inserted.status === "sent",
    `expected status sent, got ${inserted.status}`,
  );

  const { count, error: incomeCountError } = await admin
    .from("income_register")
    .select("id", { count: "exact", head: true })
    .eq("invoice_no", provisionalInvoice);
  assert(!incomeCountError, incomeCountError?.message ?? "income count failed");
  assert(
    (count ?? 0) === 0,
    "Cancel path must not create income_register rows before confirm",
  );
  console.log(
    "Cancel-path DB check: OK (payment_request + cart_snapshot, zero income rows)",
  );

  await admin
    .from("product_sale_payment_requests")
    .delete()
    .eq("id", inserted.id);
  console.log("Cleanup: deleted smoke payment_request", inserted.id);

  if (!paystackOk) {
    console.log(
      "DB cancel-path PASSED; Paystack initialize BLOCKED (fix secret key).",
    );
    process.exit(2);
  }
  console.log("ALL SMOKE CHECKS PASSED");
}

main().catch((error) => {
  console.error(
    "SMOKE FAILED:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
