/**
 * Staging E2E: POS payment link SMS uses short URL; redirect reaches Paystack checkout.
 *
 *   npx tsx scripts/test-pos-payment-link-sms-shortlink-staging.ts --env-file .env.staging.local --phone 0244303171
 */
import Module from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DEFAULT_PHONE = "0244303171";
const DEFAULT_STAGING_APP_URL =
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";
const BYPASS =
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ??
  "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") return {};
    return originalLoad(request, parent, isMain);
  };

function loadEnvForce(filePath: string) {
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

function parsePhone(argv: string[]): string {
  const idx = argv.indexOf("--phone");
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1]!.trim() : DEFAULT_PHONE;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function initializePaystackCheckout(
  secret: string,
  label: string,
): Promise<{ authorizationUrl: string; reference: string }> {
  const amountGhs = 1.01;
  const reference = `pos_sms_short_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: "pos-sms-shortlink-smoke@davorsfacilities.com",
      amount: Math.round(amountGhs * 100),
      currency: "GHS",
      reference,
      channels: ["card", "mobile_money"],
      callback_url: "https://example.com/pay/product-sale/callback",
      metadata: { flow: `pos_sms_shortlink_${label}` },
    }),
  });
  const payload = (await response.json()) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; reference?: string };
  };
  assert(response.ok && payload.status !== false, payload.message ?? "Paystack init failed");
  const authorizationUrl = payload.data?.authorization_url?.trim() ?? "";
  assert(authorizationUrl.includes("paystack"), "Missing Paystack authorization_url");
  return {
    authorizationUrl,
    reference: payload.data?.reference?.trim() || reference,
  };
}

async function verifyShortLinkRedirect(shortUrl: string, expectedDestination: string) {
  const headers: Record<string, string> = {};
  if (shortUrl.includes("vercel.app")) {
    headers["x-vercel-protection-bypass"] = BYPASS;
  }

  const first = await fetch(shortUrl, { redirect: "manual", headers });
  assert(
    first.status === 302 || first.status === 307 || first.status === 308,
    `Expected redirect, got HTTP ${first.status}`,
  );
  const location = first.headers.get("location")?.trim() ?? "";
  assert(location, "Redirect missing Location header");
  assert(
    location === expectedDestination || location.startsWith(expectedDestination),
    `Redirect target mismatch: ${location.slice(0, 120)}`,
  );

  const followed = await fetch(shortUrl, { redirect: "follow", headers });
  const finalUrl = followed.url;
  assert(
    /paystack\.(com|co)/i.test(finalUrl),
    `Followed redirect did not reach Paystack: ${finalUrl}`,
  );
  return { location, finalUrl, httpStatus: followed.status };
}

async function runVariant(options: {
  label: "cart" | "invoice";
  secret: string;
  phone: string;
  tenantName: string;
  recipientName: string;
  sendSms: boolean;
}) {
  const { authorizationUrl } = await initializePaystackCheckout(
    options.secret,
    options.label,
  );

  const { createShortLinkUrl } = await import("../utils/short-links");
  const shortUrl = await createShortLinkUrl(authorizationUrl);

  assert(
    /\/s\/[A-Za-z0-9]{6,12}$/.test(shortUrl),
    `Short URL shape invalid: ${shortUrl}`,
  );
  assert(
    !shortUrl.includes("checkout.paystack"),
    "SMS link must not be raw Paystack URL",
  );
  assert(
    !authorizationUrl.includes("/s/"),
    "Paystack URL sanity check failed",
  );

  const invoiceLabel =
    options.label === "cart" ? "your POS order" : "invoice INV-SMS-SHORT";
  const amountLabel = "1.01";
  const smsBody = `Davors: Pay GHS ${amountLabel} for ${invoiceLabel}: ${shortUrl}`;

  assert(!smsBody.includes("checkout.paystack"), "SMS body contains raw Paystack URL");
  assert(smsBody.includes("/s/"), "SMS body missing short link path");

  let smsResult: { ok: boolean; id?: string | null; error?: string } | null = null;
  if (options.sendSms) {
    const { sendHubtelSms } = await import("../utils/hubtel-sms");
    process.env.SMS_PROVIDER = "hubtel";
    process.env.NON_OTP_SMS_ENABLED = "true";
    smsResult = await sendHubtelSms({
      to: options.phone,
      content: smsBody,
      tenantName: options.tenantName,
      recipientName: options.recipientName,
    });
    assert(smsResult.ok, smsResult.error ?? "SMS send failed");
  }

  const redirect = await verifyShortLinkRedirect(shortUrl, authorizationUrl);

  return {
    label: options.label,
    shortUrl,
    paystackUrl: authorizationUrl.slice(0, 80) + "…",
    smsBodyPreview: smsBody.slice(0, 160) + "…",
    smsMessageId: smsResult?.ok ? smsResult.id : null,
    redirect,
  };
}

async function main() {
  const idx = process.argv.indexOf("--env-file");
  const envFile =
    idx >= 0 && process.argv[idx + 1]
      ? resolve(process.cwd(), process.argv[idx + 1]!)
      : resolve(process.cwd(), ".env.staging.local");
  loadEnvForce(envFile);

  // Prefer explicit staging app URL for short-link base (matches deployed Vercel preview).
  const stagingSite =
    process.env.STAGING_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    DEFAULT_STAGING_APP_URL;
  if (!stagingSite.includes("localhost")) {
    process.env.NEXT_PUBLIC_SITE_URL = stagingSite.replace(/\/$/, "");
  }

  const phone = parsePhone(process.argv.slice(2));
  const sendSms = !process.argv.includes("--no-sms");

  const secret = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING_REF), "Refusing non-staging Supabase");
  assert(secret.startsWith("sk_test_"), "PAYSTACK_SECRET_KEY must be staging test key");

  const { createClient } = await import("@supabase/supabase-js");
  const { resolveTenantDisplayName } = await import("../utils/tenant-display-name");
  const { resolvePublicSiteUrl } = await import("../utils/public-site-url");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: tenant } = await admin.from("tenants").select("id").limit(1).maybeSingle();
  assert(tenant?.id, "No staging tenant");
  const tenantName = await resolveTenantDisplayName(admin, tenant.id);

  console.log("=== POS payment link SMS short-link staging test ===");
  console.log("siteBase:", resolvePublicSiteUrl());
  console.log("phone:", phone);
  console.log("sendSms:", sendSms);

  const cart = await runVariant({
    label: "cart",
    secret,
    phone,
    tenantName,
    recipientName: "Walk-in Customer",
    sendSms,
  });
  const invoice = await runVariant({
    label: "invoice",
    secret,
    phone,
    tenantName,
    recipientName: "Customer",
    sendSms,
  });

  console.log("\n=== RESULTS ===");
  for (const r of [cart, invoice]) {
    console.log(`\n[PASS] ${r.label} path`);
    console.log("  shortUrl:", r.shortUrl);
    console.log("  smsPreview:", r.smsBodyPreview);
    console.log("  smsMessageId:", r.smsMessageId ?? "(skipped)");
    console.log("  redirect →", r.redirect.location.slice(0, 100) + "…");
    console.log("  finalUrl:", r.redirect.finalUrl.slice(0, 100) + "…");
  }

  console.log("\nSUMMARY: cart + invoice short-link SMS paths OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
