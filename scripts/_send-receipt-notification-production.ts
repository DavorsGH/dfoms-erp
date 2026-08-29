/**
 * Send receipt_issued notifications (bell + email/PDF + SMS) for existing receipts.
 * Use for historical gaps, failed sends, or contact-detail updates — not for new payments
 * (those notify via recordClientInvoicePayment).
 *
 * Usage:
 *   npx tsx scripts/_send-receipt-notification-production.ts --receipts DF-RCPT-0006,DF-RCPT-0007 --to you@example.com
 *   npx tsx scripts/_send-receipt-notification-production.ts --receipts DF-RCPT-0006,DF-RCPT-0007
 *   npx tsx scripts/_send-receipt-notification-production.ts --receipts DF-RCPT-0006 --dry-run
 */
// @ts-nocheck
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad(request, parent, isMain);
};

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function parseReceiptNumbers(raw) {
  if (!raw?.trim()) {
    throw new Error("--receipts is required (comma-separated receipt numbers).");
  }
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function withCustomerEmailOverride(admin, tenantId, clientId, to, fn) {
  if (!to) {
    await fn();
    return;
  }

  const { data: customer, error } = await admin
    .from("customers")
    .select("email")
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  const originalEmail = customer?.email ?? null;
  await admin
    .from("customers")
    .update({ email: to })
    .eq("tenant_id", tenantId)
    .eq("client_id", clientId);

  try {
    await fn();
  } finally {
    if (originalEmail !== null) {
      await admin
        .from("customers")
        .update({ email: originalEmail })
        .eq("tenant_id", tenantId)
        .eq("client_id", clientId);
    }
  }
}

async function loadReceipt(admin, receiptNumber) {
  const { data, error } = await admin
    .from("client_receipts")
    .select(
      "id, tenant_id, receipt_number, receipt_date, amount, invoice:client_invoices!client_receipts_invoice_id_fkey(invoice_number, bill_to_name, client_id)",
    )
    .eq("tenant_id", DAVORS)
    .eq("receipt_number", receiptNumber)
    .maybeSingle();

  if (error) {
    throw new Error(`${receiptNumber}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`${receiptNumber}: receipt not found for Davors tenant.`);
  }

  return data;
}

async function preflightNotificationChannels(admin, tenantId, clientId) {
  const [ruleResult, customerResult, portalUserResult] = await Promise.all([
    admin
      .from("transactional_notification_rules")
      .select("channel, is_active, template_id")
      .eq("tenant_id", tenantId)
      .eq("event_type", "receipt_issued")
      .maybeSingle(),
    admin
      .from("customers")
      .select("client_id, client_name, email, phone")
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .maybeSingle(),
    admin
      .from("user_accounts")
      .select("auth_uid")
      .eq("tenant_id", tenantId)
      .eq("client_id", clientId)
      .eq("role", "client")
      .neq("is_active", false)
      .maybeSingle(),
  ]);

  const rule = ruleResult.data;
  const customer = customerResult.data;
  const portalUser = portalUserResult.data;

  const ruleActive = Boolean(rule?.is_active && rule?.template_id);
  const channel = ruleActive ? String(rule.channel ?? "none") : "none";
  const emailOnFile = (customer?.email ?? "").trim();
  const phoneOnFile = (customer?.phone ?? "").trim();
  const portalAuthUid =
    typeof portalUser?.auth_uid === "string" ? portalUser.auth_uid.trim() : "";

  const wantsEmail =
    ruleActive && (channel === "email" || channel === "both" || channel === "sms");
  const wantsSms = ruleActive && (channel === "sms" || channel === "both");

  return {
    customerName: customer?.client_name?.trim() || clientId,
    emailOnFile,
    phoneOnFile,
    ruleActive,
    channel,
    bellEligible: Boolean(portalAuthUid),
    attempted: {
      bell: Boolean(portalAuthUid),
      email: wantsEmail && Boolean(emailOnFile),
      sms: wantsSms && Boolean(phoneOnFile),
    },
    skipped: {
      bell: !portalAuthUid ? "no active client portal user" : null,
      email: !wantsEmail
        ? "rule channel does not include email"
        : !emailOnFile
          ? "no email on customer record"
          : null,
      sms: !wantsSms
        ? "rule channel does not include sms"
        : !phoneOnFile
          ? "no phone on customer record"
          : null,
    },
  };
}

function printChannelLine(label, attempted, skippedReason) {
  if (attempted) {
    console.log(`    ${label}: attempted (best-effort dispatch)`);
  } else {
    console.log(`    ${label}: skipped — ${skippedReason ?? "not eligible"}`);
  }
}

async function processReceipt(admin, receiptNumber, emailOverride, dryRun) {
  const receipt = await loadReceipt(admin, receiptNumber);
  const invoice = receipt.invoice;
  const invoiceNumber = invoice?.invoice_number ?? "";
  const clientId = invoice?.client_id ?? "";
  const billToName = invoice?.bill_to_name?.trim() || clientId;

  if (!clientId) {
    throw new Error(`${receiptNumber}: linked invoice is missing client_id.`);
  }

  const preflight = await preflightNotificationChannels(admin, DAVORS, clientId);

  console.log(`\n${receiptNumber}`);
  console.log(`  invoice:        ${invoiceNumber}`);
  console.log(`  client_id:      ${clientId}`);
  console.log(`  customer:       ${preflight.customerName}`);
  console.log(`  bill_to_name:   ${billToName}`);
  console.log(`  amount:         ${receipt.amount}`);
  console.log(`  payment_date:   ${receipt.receipt_date}`);
  console.log(`  email on file:  ${preflight.emailOnFile || "(none)"}`);
  console.log(`  phone on file:  ${preflight.phoneOnFile || "(none)"}`);
  if (emailOverride) {
    console.log(`  email override: ${emailOverride} (temporary for this send)`);
  }
  console.log(
    `  rule:           ${preflight.ruleActive ? `receipt_issued / ${preflight.channel} (active)` : "none or inactive"}`,
  );
  console.log("  channels:");

  const effectiveEmail = emailOverride || preflight.emailOnFile;
  const emailAttempt =
    preflight.attempted.email || (Boolean(emailOverride) && preflight.ruleActive);

  printChannelLine(
    "bell",
    preflight.attempted.bell,
    preflight.skipped.bell,
  );
  if (emailOverride) {
    printChannelLine(
      "email",
      emailAttempt,
      !preflight.ruleActive
        ? "rule inactive"
        : !effectiveEmail
          ? "no override or email"
          : null,
    );
  } else {
    printChannelLine(
      "email",
      preflight.attempted.email,
      preflight.skipped.email,
    );
  }
  printChannelLine("sms", preflight.attempted.sms, preflight.skipped.sms);

  if (dryRun) {
    const wouldSendTo = emailOverride || preflight.emailOnFile || "(no email on file)";
    console.log(`  result:         DRY RUN — no notification sent (would email: ${wouldSendTo})`);
    return;
  }

  const { notifyClientReceiptIssued } = await import(
    "../utils/client-document-notifications.ts"
  );

  await withCustomerEmailOverride(admin, DAVORS, clientId, emailOverride, async () => {
    await notifyClientReceiptIssued({
      tenantId: DAVORS,
      clientId,
      receiptId: receipt.id,
      receiptNumber: receipt.receipt_number,
      invoiceNumber,
      customerName: billToName,
      amount: String(receipt.amount ?? ""),
      paymentDate: receipt.receipt_date ?? "",
    });
  });

  const sentTo = emailOverride || preflight.emailOnFile || "(no email on file)";
  console.log(`  result:         notification dispatched (best-effort) -> email target: ${sentTo}`);
}

async function main() {
  const receiptNumbers = parseReceiptNumbers(argValue("--receipts"));
  const emailOverride = argValue("--to")?.trim() || null;
  const dryRun = process.argv.includes("--dry-run");
  const envFile = argValue("--env-file") ?? ".env.local.backup";

  loadEnvForce(resolve(process.cwd(), envFile));

  const ref = /^https?:\/\/([^.]+)\.supabase\.co/.exec(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  )?.[1];
  if (ref !== PRODUCTION_REF) {
    throw new Error(`Expected production ref ${PRODUCTION_REF}, got ${ref ?? "unknown"}`);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  console.log("=== Send receipt_issued notifications ===");
  console.log(`Tenant: ${DAVORS}`);
  console.log(`Receipts: ${receiptNumbers.join(", ")}`);
  console.log(
    dryRun
      ? "Mode: DRY RUN (preflight only — no notifications sent)"
      : emailOverride
        ? `Mode: TEST (--to override: ${emailOverride})`
        : "Mode: PRODUCTION (customer contacts on file)",
  );

  for (const receiptNumber of receiptNumbers) {
    await processReceipt(admin, receiptNumber, emailOverride, dryRun);
  }

  console.log(dryRun ? "\nDry run complete. Re-run without --dry-run to send." : "\nDone.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
