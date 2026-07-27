/**
 * Staging: SMS credit gating for transactional notifications.
 * Mirrors utils/transactional-notification-trigger.ts send decision + debit_sms_credit.
 * Usage: node scripts/test-sms-credit-txn-notif-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function substitute(template, vars) {
  return String(template ?? "").replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : "",
  );
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

// Source-level confirmation the app code was updated
const triggerSrc = readFileSync(
  resolve(process.cwd(), "utils/transactional-notification-trigger.ts"),
  "utf8",
);
assert(
  triggerSrc.includes('rpc(\n        "debit_sms_credit"') ||
    triggerSrc.includes('rpc("debit_sms_credit"') ||
    /debit_sms_credit/.test(triggerSrc),
  "trigger source missing debit_sms_credit call",
);
assert(
  /channel === "sms" && !smsCreditAvailable/.test(triggerSrc),
  "trigger source missing sms-only email fallback",
);
console.log("Source check: debit_sms_credit + sms fallback present in trigger.ts");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sendLog = [];

/** Mirror of fireTransactionalNotification channel/debit/send decision. */
async function fireMirrored(tenantId, eventType, customerId, variables) {
  const { data: rule, error: ruleError } = await admin
    .from("transactional_notification_rules")
    .select("id, template_id, channel, is_active")
    .eq("tenant_id", tenantId)
    .eq("event_type", eventType)
    .maybeSingle();
  assert(!ruleError, ruleError?.message);
  assert(rule?.is_active && rule.template_id, "active rule required");

  const channel = String(rule.channel);

  const { data: template, error: templateError } = await admin
    .from("message_templates")
    .select("id, subject, body_email, body_sms, is_active")
    .eq("id", rule.template_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  assert(!templateError && template?.is_active, "active template required");

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("client_id, client_name, email, phone")
    .eq("tenant_id", tenantId)
    .eq("client_id", customerId)
    .maybeSingle();
  assert(!customerError && customer, "customer required");

  const vars = {
    customer_name: customer.client_name?.trim() || customer.client_id,
    customer_id: customer.client_id,
    ...variables,
  };

  const wantsSms = channel === "sms" || channel === "both";
  let smsCreditAvailable = false;

  if (wantsSms) {
    const { data: debitOk, error: debitError } = await admin.rpc(
      "debit_sms_credit",
      { p_tenant_id: tenantId },
    );
    assert(!debitError, `debit_sms_credit: ${debitError?.message}`);
    smsCreditAvailable = debitOk === true;
  }

  const sendEmail =
    channel === "email" ||
    channel === "both" ||
    (channel === "sms" && !smsCreditAvailable);
  const sendSms = smsCreditAvailable;

  if (sendEmail) {
    const to = (customer.email ?? "").trim();
    assert(to, "customer email required for email path");
    sendLog.push({
      kind: "email",
      to,
      subjectOrContent: substitute(template.subject ?? "", vars),
    });
  }

  if (sendSms) {
    const to = (customer.phone ?? "").trim();
    assert(to, "customer phone required for SMS path");
    sendLog.push({
      kind: "sms",
      to,
      subjectOrContent: substitute(template.body_sms ?? "", vars),
    });
  }

  return { channel, smsCreditAvailable, sendEmail, sendSms };
}

async function setWalletBalance(balance) {
  const { data: wallet } = await admin
    .from("sms_credit_wallets")
    .select("balance")
    .eq("tenant_id", CAANTA)
    .maybeSingle();

  if (!wallet) {
    if (balance <= 0) return;
    const { error } = await admin.rpc("credit_sms_purchase", {
      p_tenant_id: CAANTA,
      p_credits: balance,
      p_reference: `manual-test-seed-${Date.now()}`,
    });
    assert(!error, `seed: ${error?.message}`);
    return;
  }

  let current = Number(wallet.balance) || 0;
  while (current > balance) {
    const { data: ok, error } = await admin.rpc("debit_sms_credit", {
      p_tenant_id: CAANTA,
    });
    assert(!error && ok === true, "drain debit failed");
    current -= 1;
  }
  if (current < balance) {
    const { error } = await admin.rpc("credit_sms_purchase", {
      p_tenant_id: CAANTA,
      p_credits: balance - current,
      p_reference: `manual-test-topup-${Date.now()}`,
    });
    assert(!error, `topup: ${error?.message}`);
  }
}

const stamp = Date.now();
const customerId = `CAN-SMS-${stamp}`;

const { error: custErr } = await admin.from("customers").insert({
  tenant_id: CAANTA,
  client_id: customerId,
  client_name: "SMS Credit Test Customer",
  email: "sms-credit-test@example.com",
  phone: "0244000000",
  status: "active",
  customer_type: "service_client",
});
assert(!custErr, `customer: ${custErr?.message}`);

const { data: tmplBoth, error: tmplBothErr } = await admin
  .from("message_templates")
  .insert({
    tenant_id: CAANTA,
    name: `SMS credit both ${stamp}`,
    template_type: "transactional",
    channel: "both",
    subject: `Both ${stamp}`,
    body_email: "Email for {{customer_name}}",
    body_sms: "SMS for {{customer_name}}",
    is_active: true,
  })
  .select("id")
  .single();
assert(!tmplBothErr && tmplBoth, tmplBothErr?.message);

const { data: tmplSms, error: tmplSmsErr } = await admin
  .from("message_templates")
  .insert({
    tenant_id: CAANTA,
    name: `SMS credit sms ${stamp}`,
    template_type: "transactional",
    channel: "sms",
    subject: `Fallback ${stamp}`,
    body_email: "Fallback email for {{customer_name}}",
    body_sms: "SMS only for {{customer_name}}",
    is_active: true,
  })
  .select("id")
  .single();
assert(!tmplSmsErr && tmplSms, tmplSmsErr?.message);

const { data: priorRule } = await admin
  .from("transactional_notification_rules")
  .select("id, template_id, channel, is_active")
  .eq("tenant_id", CAANTA)
  .eq("event_type", "sale_completed")
  .maybeSingle();

let activeRuleId = priorRule?.id ?? null;

async function upsertRule(channel, templateId) {
  if (activeRuleId) {
    const { error } = await admin
      .from("transactional_notification_rules")
      .update({ template_id: templateId, channel, is_active: true })
      .eq("id", activeRuleId);
    assert(!error, error?.message);
    return;
  }
  const { data, error } = await admin
    .from("transactional_notification_rules")
    .insert({
      tenant_id: CAANTA,
      event_type: "sale_completed",
      template_id: templateId,
      channel,
      is_active: true,
    })
    .select("id")
    .single();
  assert(!error && data, error?.message);
  activeRuleId = data.id;
}

try {
  // (a)
  await setWalletBalance(0);
  await upsertRule("both", tmplBoth.id);
  sendLog.length = 0;
  const a = await fireMirrored(CAANTA, "sale_completed", customerId, {
    invoice_no: `A-${stamp}`,
  });
  console.log("(a)", a, "sendLog", sendLog);
  assert(a.smsCreditAvailable === false, "(a) debit should fail");
  assert(a.sendEmail === true && a.sendSms === false, "(a) email only");
  assert(sendLog.some((s) => s.kind === "email"), "(a) email logged");
  assert(!sendLog.some((s) => s.kind === "sms"), "(a) no SMS");
  console.log("OK (a) both + 0 credits → email only, SMS skipped");

  // (b)
  await setWalletBalance(0);
  await upsertRule("sms", tmplSms.id);
  sendLog.length = 0;
  const b = await fireMirrored(CAANTA, "sale_completed", customerId, {
    invoice_no: `B-${stamp}`,
  });
  console.log("(b)", b, "sendLog", sendLog);
  assert(b.smsCreditAvailable === false, "(b) debit should fail");
  assert(b.sendEmail === true && b.sendSms === false, "(b) email fallback");
  assert(sendLog.some((s) => s.kind === "email"), "(b) email logged");
  assert(!sendLog.some((s) => s.kind === "sms"), "(b) no SMS");
  console.log("OK (b) sms + 0 credits → email fallback");

  // (c)
  const { error: creditErr } = await admin.rpc("credit_sms_purchase", {
    p_tenant_id: CAANTA,
    p_credits: 10,
    p_reference: `manual-test-${stamp}`,
  });
  assert(!creditErr, creditErr?.message);

  const { data: walletBefore } = await admin
    .from("sms_credit_wallets")
    .select("balance")
    .eq("tenant_id", CAANTA)
    .maybeSingle();
  const balBefore = Number(walletBefore?.balance) || 0;
  console.log("(c) balance before:", balBefore);
  assert(balBefore >= 1, "need credits");

  await upsertRule("both", tmplBoth.id);
  sendLog.length = 0;
  const c = await fireMirrored(CAANTA, "sale_completed", customerId, {
    invoice_no: `C-${stamp}`,
  });
  console.log("(c)", c, "sendLog", sendLog);
  assert(c.smsCreditAvailable === true, "(c) debit should succeed");
  assert(c.sendSms === true && c.sendEmail === true, "(c) both channels");
  assert(sendLog.some((s) => s.kind === "sms"), "(c) SMS attempted");
  assert(sendLog.some((s) => s.kind === "email"), "(c) email still sent");

  const { data: walletAfter } = await admin
    .from("sms_credit_wallets")
    .select("balance")
    .eq("tenant_id", CAANTA)
    .maybeSingle();
  const balAfter = Number(walletAfter?.balance) || 0;
  console.log("(c) balance after:", balAfter);
  assert(balAfter === balBefore - 1, `debit 1 expected (${balBefore}→${balAfter})`);
  console.log("OK (c) topped-up → debit_sms_credit true + SMS path taken + email");
} finally {
  if (priorRule?.id) {
    await admin
      .from("transactional_notification_rules")
      .update({
        template_id: priorRule.template_id,
        channel: priorRule.channel,
        is_active: priorRule.is_active,
      })
      .eq("id", priorRule.id);
  } else {
    await admin
      .from("transactional_notification_rules")
      .delete()
      .eq("tenant_id", CAANTA)
      .eq("event_type", "sale_completed");
  }
  await admin.from("message_templates").delete().eq("id", tmplBoth.id);
  await admin.from("message_templates").delete().eq("id", tmplSms.id);
  await admin
    .from("customers")
    .delete()
    .eq("tenant_id", CAANTA)
    .eq("client_id", customerId);
  await setWalletBalance(0);
}

console.log("\nALL SMS CREDIT TXN NOTIF TESTS PASSED");
