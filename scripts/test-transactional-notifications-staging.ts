/**
 * Staging smoke: transactional notification rules + opt-out bypass + wiring.
 * Usage: npx tsx scripts/test-transactional-notifications-staging.ts
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

const sendLog: Array<{ kind: "email" | "sms"; to: string; subjectOrContent: string }> =
  [];

const originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })
  ._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load = function (
  request: unknown,
  parent: unknown,
  isMain: unknown,
) {
  if (request === "server-only") {
    return {};
  }
  if (request === "@/utils/resend-email" || String(request).endsWith("resend-email")) {
    return {
      sendResendEmail: async (options: { to: string; subject: string }) => {
        sendLog.push({
          kind: "email",
          to: options.to,
          subjectOrContent: options.subject,
        });
        return { ok: true, id: "stub-email" };
      },
    };
  }
  if (request === "@/utils/hubtel-sms" || String(request).endsWith("hubtel-sms")) {
    return {
      sendHubtelSms: async (options: { to: string; content: string }) => {
        sendLog.push({
          kind: "sms",
          to: options.to,
          subjectOrContent: options.content,
        });
        return { ok: true, id: "stub-sms" };
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function mask(value: string | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "MISSING";
  return `PRESENT (len=${v.length})`;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(serviceKey, "missing service key");

  console.log("RESEND_API_KEY:", mask(process.env.RESEND_API_KEY));
  console.log("HUBTEL_CLIENT_ID:", mask(process.env.HUBTEL_CLIENT_ID));
  console.log(
    "HUBTEL_CLIENT_SECRET:",
    mask(process.env.HUBTEL_CLIENT_SECRET),
  );

  // Import AFTER stubs are installed.
  const { fireTransactionalNotification } = await import(
    "../utils/transactional-notification-trigger"
  );
  const { fulfillPosCartSnapshotPaymentRequest } = await import(
    "../utils/pos-momo-fulfillment"
  );

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const customerId = `CAN-TXN-${stamp}`;
  const { error: custErr } = await admin.from("customers").insert({
    tenant_id: CAANTA,
    client_id: customerId,
    client_name: `Txn Notify Smoke ${stamp}`,
    email: `txn.${stamp}@example.com`,
    phone: "0244999001",
    customer_type: "service_client",
    status: "active",
  });
  assert(!custErr, custErr?.message ?? "customer insert failed");

  // Explicitly opted OUT of marketing SMS — transactional must still fire.
  const { error: prefErr } = await admin.from("customer_comm_preferences").insert({
    tenant_id: CAANTA,
    customer_id: customerId,
    email_opt_in: false,
    sms_opt_in: false,
    unsubscribed_at: new Date().toISOString(),
  });
  assert(!prefErr, prefErr?.message ?? "pref insert failed");

  const templates = [];
  for (const [eventHint, channel] of [
    ["sale", "email"],
    ["pay", "sms"],
    ["inv", "email"],
  ] as const) {
    const { data, error } = await admin
      .from("message_templates")
      .insert({
        tenant_id: CAANTA,
        name: `Txn ${eventHint} ${stamp}`,
        template_type: "transactional",
        channel,
        subject: channel === "email" ? `${eventHint} {{customer_name}}` : null,
        body_email:
          channel === "email"
            ? `Hello {{customer_name}} amount {{amount}} ref {{invoice_no}}{{invoice_number}}`
            : null,
        body_sms:
          channel === "sms"
            ? `Pay {{customer_name}} {{amount}} {{payment_reference}}`
            : null,
        variables: ["customer_name", "amount"],
        is_active: true,
      })
      .select("id, channel")
      .single();
    assert(!error && data, error?.message ?? "template insert failed");
    templates.push(data);
  }

  const [saleTmpl, payTmpl, invTmpl] = templates;

  async function upsertRule(
    eventType: string,
    templateId: string,
    channel: string,
    isActive: boolean,
  ) {
    const { data: existing } = await admin
      .from("transactional_notification_rules")
      .select("id")
      .eq("tenant_id", CAANTA)
      .eq("event_type", eventType)
      .maybeSingle();
    if (existing?.id) {
      const { error } = await admin
        .from("transactional_notification_rules")
        .update({
          template_id: templateId,
          channel,
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
      assert(!error, error?.message ?? "rule update failed");
      return existing.id as string;
    }
    const { data, error } = await admin
      .from("transactional_notification_rules")
      .insert({
        tenant_id: CAANTA,
        event_type: eventType,
        template_id: templateId,
        channel,
        is_active: isActive,
      })
      .select("id")
      .single();
    assert(!error && data, error?.message ?? "rule insert failed");
    return data.id as string;
  }

  await upsertRule("sale_completed", saleTmpl.id, "email", true);
  await upsertRule("payment_received", payTmpl.id, "sms", true);
  await upsertRule("invoice_created", invTmpl.id, "email", true);
  console.log("OK configured all 3 rules for Caanta");

  // --- Opt-out bypass ---
  sendLog.length = 0;
  await fireTransactionalNotification(CAANTA, "sale_completed", customerId, {
    customer_name: `Txn Notify Smoke ${stamp}`,
    amount: "12.50",
    invoice_no: "CAN-POS-TEST",
  });
  assert(
    sendLog.some((e) => e.kind === "email" && e.to.includes(`txn.${stamp}`)),
    "sale_completed should email despite marketing opt-out",
  );
  console.log("OK opt-out bypass: transactional email sent despite unsubscribed prefs");

  sendLog.length = 0;
  await fireTransactionalNotification(CAANTA, "payment_received", customerId, {
    customer_name: `Txn Notify Smoke ${stamp}`,
    amount: "12.50",
    payment_reference: "ref_test",
  });
  assert(
    sendLog.some((e) => e.kind === "sms"),
    "payment_received should SMS despite sms_opt_in=false",
  );
  console.log("OK opt-out bypass: transactional SMS sent despite sms_opt_in=false");

  // --- Disable rule ---
  await upsertRule("sale_completed", saleTmpl.id, "email", false);
  sendLog.length = 0;
  await fireTransactionalNotification(CAANTA, "sale_completed", customerId, {
    amount: "1",
    invoice_no: "X",
  });
  assert(sendLog.length === 0, "disabled rule must not send");
  console.log("OK is_active=false stops firing");
  await upsertRule("sale_completed", saleTmpl.id, "email", true);

  // --- Cash POS path simulation: sale_completed only ---
  const { data: product } = await admin
    .from("finished_products")
    .select("id, product_code, product_name, standard_selling_price")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  assert(product?.id, "need a Caanta finished product for POS cash test");

  sendLog.length = 0;
  const { data: incomeId, error: saleErr } = await admin.rpc("create_product_sale", {
    p_date: new Date().toISOString().slice(0, 10),
    p_invoice_no: null,
    p_client_id: customerId,
    p_customer_name: null,
    p_product_id: product.id,
    p_quantity: 1,
    p_unit_price: Number(product.standard_selling_price) || 1,
    p_amount_received: Number(product.standard_selling_price) || 1,
    p_payment_status: "Paid",
    p_due_date: new Date().toISOString().slice(0, 10),
    p_description: null,
    p_notes: "payment_method=Cash | txn-notify-smoke",
    p_invoice_entity_type: "POS",
  });
  assert(!saleErr && incomeId, saleErr?.message ?? "cash sale failed");

  const { data: saleRow } = await admin
    .from("income_register")
    .select("invoice_no, amount")
    .eq("id", incomeId)
    .maybeSingle();

  // Mirror POS cash checkout trigger (sale_completed only — not payment_received).
  await fireTransactionalNotification(CAANTA, "sale_completed", customerId, {
    customer_name: `Txn Notify Smoke ${stamp}`,
    invoice_no: saleRow?.invoice_no ?? "",
    amount: String(saleRow?.amount ?? ""),
    product_summary: `${product.product_name} x1`,
  });
  assert(
    sendLog.filter((e) => e.kind === "email").length === 1,
    "cash path should fire sale_completed email once",
  );
  assert(
    sendLog.filter((e) => e.kind === "sms").length === 0,
    "cash path must NOT fire payment_received",
  );
  console.log("OK cash sale path: sale_completed fires, payment_received does not");

  // Void/cleanup cash sale if possible
  await admin
    .from("income_register")
    .update({ sale_status: "voided" })
    .eq("id", incomeId)
    .eq("tenant_id", CAANTA);

  // --- MoMo / cart_snapshot fulfillment: both events ---
  sendLog.length = 0;
  const { data: payReq, error: payReqErr } = await admin
    .from("product_sale_payment_requests")
    .insert({
      tenant_id: CAANTA,
      invoice_no: `LINK-PENDING-TXN-${stamp}`,
      amount_requested: 5,
      status: "pending",
      payment_method: "Mobile Money",
      paystack_reference: `txn_ref_${stamp}`,
      cart_snapshot: {
        saleDate: new Date().toISOString().slice(0, 10),
        clientId: customerId,
        customerName: `Txn Notify Smoke ${stamp}`,
        notes: null,
        dueDate: new Date().toISOString().slice(0, 10),
        lines: [
          {
            id: "1",
            productId: product.id,
            productCode: product.product_code,
            productName: product.product_name,
            unitOfMeasure: "ea",
            quantity: 1,
            unitPrice: 5,
          },
        ],
      },
    })
    .select(
      "id, tenant_id, invoice_no, income_ids, paystack_reference, amount_requested, status, cart_snapshot, payment_method",
    )
    .single();
  assert(!payReqErr && payReq, payReqErr?.message ?? "payment request insert failed");

  const fulfilled = await fulfillPosCartSnapshotPaymentRequest(admin, payReq, {
    reference: `txn_ref_${stamp}`,
    paidAmountGhs: 5,
    skipVerify: true,
    paystackChannel: "mobile_money",
  });
  assert(!fulfilled.alreadyFulfilled, "expected new fulfillment");

  // Dynamic import fires are async — wait briefly for void promises.
  await new Promise((r) => setTimeout(r, 1500));

  assert(
    sendLog.some((e) => e.kind === "email"),
    "MoMo fulfillment should fire sale_completed (email)",
  );
  assert(
    sendLog.some((e) => e.kind === "sms"),
    "MoMo fulfillment should fire payment_received (sms)",
  );
  console.log(
    "OK MoMo fulfillment: both sale_completed and payment_received attempted",
    { invoiceNo: fulfilled.invoiceNo, sendLog },
  );

  // Cleanup MoMo sale lines
  if (fulfilled.incomeIds?.length) {
    await admin
      .from("income_register")
      .update({ sale_status: "voided" })
      .in("id", fulfilled.incomeIds)
      .eq("tenant_id", CAANTA);
  }
  await admin
    .from("product_sale_payment_requests")
    .delete()
    .eq("id", payReq.id);

  // --- Invoice created (fire path mirrors API route after successful create) ---
  sendLog.length = 0;
  await fireTransactionalNotification(CAANTA, "invoice_created", customerId, {
    customer_name: `Txn Notify Smoke ${stamp}`,
    invoice_number: `CAN-INV-SMOKE-${stamp}`,
    amount: "10.00",
    due_date: new Date().toISOString().slice(0, 10),
  });
  assert(
    sendLog.some((e) => e.kind === "email"),
    "invoice_created should fire email",
  );
  console.log("OK invoice_created fires");

  const invoiceRoute = readFileSync(
    resolve("app/api/client-invoices/route.ts"),
    "utf8",
  );
  assert(
    invoiceRoute.includes('invoice_created') &&
      invoiceRoute.includes("fireTransactionalNotification"),
    "client invoice POST must wire fireTransactionalNotification",
  );
  const posCheckout = readFileSync(
    resolve("app/dashboard/pos/pos-checkout.tsx"),
    "utf8",
  );
  assert(
    posCheckout.includes('event_type: "sale_completed"') &&
      !posCheckout.includes('event_type: "payment_received"'),
    "POS cash checkout must fire sale_completed only",
  );
  const fulfillSrc = readFileSync(
    resolve("utils/pos-momo-fulfillment.ts"),
    "utf8",
  );
  assert(
    fulfillSrc.includes("sale_completed") &&
      fulfillSrc.includes("payment_received"),
    "MoMo fulfillment must fire both events",
  );
  console.log("OK source wiring assertions");

  // Cleanup rules/templates/customer
  await admin
    .from("transactional_notification_rules")
    .delete()
    .eq("tenant_id", CAANTA)
    .in("event_type", ["sale_completed", "payment_received", "invoice_created"]);
  await admin
    .from("message_templates")
    .delete()
    .in(
      "id",
      templates.map((t) => t.id),
    );
  await admin
    .from("customer_comm_preferences")
    .delete()
    .eq("tenant_id", CAANTA)
    .eq("customer_id", customerId);
  await admin
    .from("customers")
    .delete()
    .eq("tenant_id", CAANTA)
    .eq("client_id", customerId);

  console.log("OK cleaned smoke data");
  console.log("DONE");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
