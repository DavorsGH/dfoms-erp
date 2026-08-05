import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnitBillingActivationStatus } from "@/app/dashboard/real-estate/properties-utils";
import { insertLandlordPortalNotification } from "@/utils/landlord-portal-notifications";
import {
  chargePaystackAuthorization,
  ghsToPesewas,
  initializePaystackOneOffTransaction,
  verifyPaystackTransaction,
} from "@/utils/paystack";
import { sendResendEmail } from "@/utils/resend-email";
import { ERP_SUITE_TRIAL_DAYS } from "@/utils/tenant-signup";
import {
  DEFAULT_PLATFORM_ONLY_UNIT_ACTIVATION_PRICE_GHS,
  getPlatformOnlyUnitActivationPriceGhs,
} from "@/utils/platform-billing-config";
import { postPlatformUnitActivationPaystackFinance } from "@/utils/paystack-finance-posting";
import { roundGhs } from "@/utils/product-sale-paystack";

/** @deprecated Use getPlatformOnlyUnitActivationPriceGhs() — kept for backwards compatibility. */
export const PLATFORM_ONLY_UNIT_ACTIVATION_PRICE_GHS =
  DEFAULT_PLATFORM_ONLY_UNIT_ACTIVATION_PRICE_GHS;

export const PLATFORM_ONLY_UNIT_ACTIVATION_CONTEXT =
  "platform_only_unit_activation" as const;

export type UnitActivationTriggerType =
  | "activation"
  | "reactivation"
  | "create"
  | "monthly_recurring";

export type UnitActivationChargeStatus =
  | "success"
  | "failed"
  | "skipped_trial"
  | "pending";

type LandlordAuthRow = {
  landlord_type: string | null;
  paystack_charge_authorization_code: string | null;
  paystack_charge_authorization_email: string | null;
  paystack_charge_authorization_channel: string | null;
};

type UnitBillingRow = {
  unit_id: string;
  tenant_id: string;
  property_id: string;
  unit_number: string;
  billing_activation_status: string;
};

export type ActivatePlatformOnlyUnitResult =
  | {
      ok: true;
      activated: true;
      trial: boolean;
      amountGhs: number;
      reference: string | null;
    }
  | {
      ok: true;
      requiresPayment: true;
      accessCode: string;
      reference: string;
      amountGhs: number;
    }
  | { ok: false; error: string; status: number };

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildActivationReference(tenantId: string, unitId: string): string {
  const stamp = Date.now().toString(36);
  const tenantPart = tenantId.replace(/-/g, "").slice(0, 8);
  const unitPart = unitId.replace(/-/g, "").slice(0, 8);
  return `unit-act-${tenantPart}-${unitPart}-${stamp}`;
}

/**
 * Reads landlord_subscriptions.trial_ends_at + status.
 * FLAG: No landlord_subscriptions row → returns false (charges apply).
 * ERP Suite crm_subscriptions trial does NOT apply to platform_only landlords.
 */
export async function isPlatformOnlyLandlordInTrial(
  admin: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("landlord_subscriptions")
    .select("status, trial_ends_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) {
    return false;
  }

  if (data.status !== "trialing") {
    return false;
  }

  const trialEndsAt =
    typeof data.trial_ends_at === "string" ? data.trial_ends_at.slice(0, 10) : "";
  if (!trialEndsAt) {
    return false;
  }

  return trialEndsAt >= todayIsoDate();
}

async function loadPlatformOnlyLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<LandlordAuthRow | null> {
  const { data, error } = await admin
    .from("landlords")
    .select(
      "landlord_type, paystack_charge_authorization_code, paystack_charge_authorization_email, paystack_charge_authorization_channel",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as LandlordAuthRow;
}

async function loadUnitForBilling(
  admin: SupabaseClient,
  tenantId: string,
  unitId: string,
): Promise<UnitBillingRow | null> {
  const { data, error } = await admin
    .from("property_units")
    .select(
      "unit_id, tenant_id, property_id, unit_number, billing_activation_status",
    )
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return data as UnitBillingRow;
}

async function resolveBillingEmail(
  admin: SupabaseClient,
  tenantId: string,
  fallbackEmail: string | null,
): Promise<string | null> {
  const { data } = await admin
    .from("tenants")
    .select("email")
    .eq("id", tenantId)
    .maybeSingle();

  const tenantEmail =
    typeof data?.email === "string" ? data.email.trim() : "";
  return tenantEmail || fallbackEmail?.trim() || null;
}

export async function saveLandlordPaystackChargeAuthorization(
  admin: SupabaseClient,
  tenantId: string,
  options: {
    authorizationCode: string;
    email: string;
    channel: string | null;
  },
): Promise<void> {
  const { error } = await admin
    .from("landlords")
    .update({
      paystack_charge_authorization_code: options.authorizationCode.trim(),
      paystack_charge_authorization_email: options.email.trim(),
      paystack_charge_authorization_channel: options.channel?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(`Failed to store Paystack authorization: ${error.message}`);
  }
}

export async function insertUnitActivationChargeAudit(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    unitId: string | null;
    amountGhs: number;
    chargeStatus: UnitActivationChargeStatus;
    paystackReference: string | null;
    failureReason: string | null;
    triggerType: UnitActivationTriggerType;
  },
): Promise<void> {
  const { error } = await admin.from("landlord_unit_activation_charges").insert({
    tenant_id: options.tenantId,
    unit_id: options.unitId,
    amount_ghs: options.amountGhs,
    charge_status: options.chargeStatus,
    paystack_reference: options.paystackReference,
    failure_reason: options.failureReason,
    trigger_type: options.triggerType,
  });

  if (error) {
    throw new Error(`Failed to write activation charge audit: ${error.message}`);
  }
}

async function postUnitActivationPaystackFinanceRecords(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    unitId: string;
    unitNumber: string;
    reference: string;
    transactionAmountGhs: number;
    paidAt: string | null;
    triggerType?: UnitActivationTriggerType | null;
  },
): Promise<void> {
  await postPlatformUnitActivationPaystackFinance(admin, {
    reference: options.reference,
    transactionAmountGhs: roundGhs(options.transactionAmountGhs),
    paidAt: options.paidAt,
    landlordTenantId: options.tenantId,
    unitId: options.unitId,
    unitNumber: options.unitNumber,
    triggerType: options.triggerType ?? null,
  });
}

async function setUnitBillingActive(
  admin: SupabaseClient,
  tenantId: string,
  unitId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from("property_units")
    .update({
      billing_activation_status: "active",
      billing_activated_at: now,
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId);

  if (error) {
    throw new Error(`Failed to activate unit billing: ${error.message}`);
  }
}

export async function deactivatePlatformOnlyUnitBilling(
  admin: SupabaseClient,
  tenantId: string,
  unitId: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  const landlord = await loadPlatformOnlyLandlord(admin, tenantId);
  if (!landlord || landlord.landlord_type !== "platform_only") {
    return {
      ok: false,
      error: "Unit billing deactivation is only for platform_only landlords.",
      status: 403,
    };
  }

  const unit = await loadUnitForBilling(admin, tenantId, unitId);
  if (!unit) {
    return { ok: false, error: "Unit not found.", status: 404 };
  }

  if (unit.billing_activation_status !== "active") {
    return { ok: false, error: "Unit billing is already inactive.", status: 409 };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("property_units")
    .update({
      billing_activation_status: "inactive",
      updated_at: now,
    })
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId);

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }

  return { ok: true };
}

async function notifyUnitActivationChargeResult(options: {
  tenantId: string;
  unitNumber: string;
  success: boolean;
  amountGhs: number;
  trial: boolean;
  failureReason?: string;
}): Promise<void> {
  const title = options.success
    ? options.trial
      ? "Unit activated (trial)"
      : "Unit billing activated"
    : "Unit activation charge failed";

  const body = options.success
    ? options.trial
      ? `Unit ${options.unitNumber} is active for billing. No charge during your free trial.`
      : `Unit ${options.unitNumber} is active for billing. GHS ${options.amountGhs.toFixed(2)} was charged.`
    : `Could not charge GHS ${options.amountGhs.toFixed(2)} for unit ${options.unitNumber}: ${options.failureReason ?? "Payment failed."}`;

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title,
    body,
    actionUrl: "/landlord-portal/real-estate/units",
    context: `unit-activation:${options.unitNumber}`,
  });

  try {
    const admin = (await import("@/utils/supabase/admin")).createAdminClient();
    const { data: tenant } = await admin
      .from("tenants")
      .select("email, name")
      .eq("id", options.tenantId)
      .maybeSingle();

    const email =
      typeof tenant?.email === "string" ? tenant.email.trim() : "";
    if (!email) {
      return;
    }

    await sendResendEmail({
      to: email,
      subject: title,
      html: `<p>${body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p><p>Davors Facilities</p>`,
    });
  } catch (error) {
    console.error(
      "[platform-only-unit-billing] activation notification email failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

function resolveTriggerType(
  currentStatus: string,
  requested: UnitActivationTriggerType,
): UnitActivationTriggerType {
  if (requested === "create") {
    return "create";
  }
  return currentStatus === "inactive" ? "reactivation" : "activation";
}

export async function activatePlatformOnlyUnitForBilling(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    unitId: string;
    triggerType: UnitActivationTriggerType;
    billingEmailFallback?: string | null;
    callbackUrl?: string;
  },
): Promise<ActivatePlatformOnlyUnitResult> {
  const landlord = await loadPlatformOnlyLandlord(admin, options.tenantId);
  if (!landlord || landlord.landlord_type !== "platform_only") {
    return {
      ok: false,
      error: "Unit billing activation is only for platform_only landlords.",
      status: 403,
    };
  }

  const unit = await loadUnitForBilling(admin, options.tenantId, options.unitId);
  if (!unit) {
    return { ok: false, error: "Unit not found.", status: 404 };
  }

  const billingStatus = unit.billing_activation_status ?? "inactive";
  if (!isUnitBillingActivationStatus(billingStatus)) {
    return { ok: false, error: "Invalid billing activation status on unit.", status: 400 };
  }

  if (billingStatus === "active") {
    return { ok: false, error: "Unit billing is already active.", status: 409 };
  }

  const triggerType = resolveTriggerType(billingStatus, options.triggerType);
  const amountGhs = await getPlatformOnlyUnitActivationPriceGhs(admin);
  const inTrial = await isPlatformOnlyLandlordInTrial(admin, options.tenantId);

  if (inTrial) {
    await setUnitBillingActive(admin, options.tenantId, options.unitId);
    await insertUnitActivationChargeAudit(admin, {
      tenantId: options.tenantId,
      unitId: options.unitId,
      amountGhs,
      chargeStatus: "skipped_trial",
      paystackReference: null,
      failureReason: null,
      triggerType,
    });
    await notifyUnitActivationChargeResult({
      tenantId: options.tenantId,
      unitNumber: unit.unit_number,
      success: true,
      amountGhs,
      trial: true,
    });
    return {
      ok: true,
      activated: true,
      trial: true,
      amountGhs,
      reference: null,
    };
  }

  const authCode = landlord.paystack_charge_authorization_code?.trim() ?? "";
  const authEmail =
    landlord.paystack_charge_authorization_email?.trim() ||
    (await resolveBillingEmail(
      admin,
      options.tenantId,
      options.billingEmailFallback ?? null,
    )) ||
    "";

  if (authCode && authEmail) {
    const reference = buildActivationReference(options.tenantId, options.unitId);
    const charged = await chargePaystackAuthorization({
      authorizationCode: authCode,
      email: authEmail,
      amountPesewas: ghsToPesewas(amountGhs),
      reference,
      metadata: {
        context: PLATFORM_ONLY_UNIT_ACTIVATION_CONTEXT,
        tenant_id: options.tenantId,
        unit_id: options.unitId,
        trigger_type: triggerType,
      },
    });

    if (!charged.ok) {
      await insertUnitActivationChargeAudit(admin, {
        tenantId: options.tenantId,
        unitId: options.unitId,
        amountGhs,
        chargeStatus: "failed",
        paystackReference: reference,
        failureReason: charged.error,
        triggerType,
      });
      await notifyUnitActivationChargeResult({
        tenantId: options.tenantId,
        unitNumber: unit.unit_number,
        success: false,
        amountGhs,
        trial: false,
        failureReason: charged.error,
      });
      return { ok: false, error: charged.error, status: 402 };
    }

    await setUnitBillingActive(admin, options.tenantId, options.unitId);
    await insertUnitActivationChargeAudit(admin, {
      tenantId: options.tenantId,
      unitId: options.unitId,
      amountGhs,
      chargeStatus: "success",
      paystackReference: charged.reference,
      failureReason: null,
      triggerType,
    });
    await postUnitActivationPaystackFinanceRecords(admin, {
      tenantId: options.tenantId,
      unitId: options.unitId,
      unitNumber: unit.unit_number,
      reference: charged.reference,
      transactionAmountGhs: amountGhs,
      paidAt: new Date().toISOString(),
      triggerType,
    });
    await notifyUnitActivationChargeResult({
      tenantId: options.tenantId,
      unitNumber: unit.unit_number,
      success: true,
      amountGhs,
      trial: false,
    });
    return {
      ok: true,
      activated: true,
      trial: false,
      amountGhs,
      reference: charged.reference,
    };
  }

  const billingEmail = authEmail || (await resolveBillingEmail(
    admin,
    options.tenantId,
    options.billingEmailFallback ?? null,
  ));
  if (!billingEmail) {
    return {
      ok: false,
      error:
        "Set a billing email on your workspace before activating units for billing.",
      status: 400,
    };
  }

  if (!options.callbackUrl?.trim()) {
    return {
      ok: false,
      error: "callbackUrl is required when no Paystack authorization is on file.",
      status: 500,
    };
  }

  const reference = buildActivationReference(options.tenantId, options.unitId);
  const initialized = await initializePaystackOneOffTransaction({
    email: billingEmail,
    amountPesewas: ghsToPesewas(amountGhs),
    callbackUrl: options.callbackUrl,
    metadata: {
      context: PLATFORM_ONLY_UNIT_ACTIVATION_CONTEXT,
      tenant_id: options.tenantId,
      unit_id: options.unitId,
      trigger_type: triggerType,
    },
  });

  if (!initialized.ok) {
    return { ok: false, error: initialized.error, status: 502 };
  }

  await insertUnitActivationChargeAudit(admin, {
    tenantId: options.tenantId,
    unitId: options.unitId,
    amountGhs,
    chargeStatus: "pending",
    paystackReference: initialized.reference,
    failureReason: null,
    triggerType,
  });

  return {
    ok: true,
    requiresPayment: true,
    accessCode: initialized.accessCode,
    reference: initialized.reference,
    amountGhs,
  };
}

export async function confirmPlatformOnlyUnitActivationPayment(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    unitId: string;
    reference: string;
    billingEmailFallback?: string | null;
  },
): Promise<
  | { ok: true; activated: true; reference: string }
  | { ok: false; error: string; status: number }
> {
  const reference = options.reference.trim();
  if (!reference) {
    return { ok: false, error: "reference is required.", status: 400 };
  }

  const verified = await verifyPaystackTransaction(reference);
  if (!verified.ok) {
    return { ok: false, error: verified.error, status: 502 };
  }
  if (verified.status !== "success") {
    return {
      ok: false,
      error: `Payment not successful yet (status: ${verified.status}).`,
      status: 409,
    };
  }

  const unit = await loadUnitForBilling(admin, options.tenantId, options.unitId);
  if (!unit) {
    return { ok: false, error: "Unit not found.", status: 404 };
  }

  if (unit.billing_activation_status === "active") {
    const amountGhs =
      verified.amount != null && verified.amount > 0
        ? roundGhs(verified.amount / 100)
        : await getPlatformOnlyUnitActivationPriceGhs(admin);
    await postUnitActivationPaystackFinanceRecords(admin, {
      tenantId: options.tenantId,
      unitId: options.unitId,
      unitNumber: unit.unit_number,
      reference: verified.reference,
      transactionAmountGhs: amountGhs,
      paidAt: verified.paidAt,
      triggerType: "activation",
    });
    return { ok: true, activated: true, reference: verified.reference };
  }

  const { data: pendingAudit } = await admin
    .from("landlord_unit_activation_charges")
    .select("amount_ghs")
    .eq("tenant_id", options.tenantId)
    .eq("unit_id", options.unitId)
    .eq("paystack_reference", reference)
    .eq("charge_status", "pending")
    .maybeSingle();

  const auditAmount = Number(pendingAudit?.amount_ghs);
  const amountGhs = Number.isFinite(auditAmount)
    ? auditAmount
    : verified.amount != null && verified.amount > 0
      ? roundGhs(verified.amount / 100)
      : await getPlatformOnlyUnitActivationPriceGhs(admin);

  if (
    verified.authorizationCode &&
    (verified.authorizationReusable === true ||
      verified.authorizationReusable === null)
  ) {
    const email =
      verified.authorizationEmail ||
      verified.customerEmail ||
      (await resolveBillingEmail(
        admin,
        options.tenantId,
        options.billingEmailFallback ?? null,
      )) ||
      "";
    if (email) {
      await saveLandlordPaystackChargeAuthorization(admin, options.tenantId, {
        authorizationCode: verified.authorizationCode,
        email,
        channel: verified.authorizationChannel || verified.channel,
      });
    }
  }

  await setUnitBillingActive(admin, options.tenantId, options.unitId);
  await insertUnitActivationChargeAudit(admin, {
    tenantId: options.tenantId,
    unitId: options.unitId,
    amountGhs,
    chargeStatus: "success",
    paystackReference: verified.reference,
    failureReason: null,
    triggerType: "activation",
  });

  await postUnitActivationPaystackFinanceRecords(admin, {
    tenantId: options.tenantId,
    unitId: options.unitId,
    unitNumber: unit.unit_number,
    reference: verified.reference,
    transactionAmountGhs: amountGhs,
    paidAt: verified.paidAt,
    triggerType: "activation",
  });

  await notifyUnitActivationChargeResult({
    tenantId: options.tenantId,
    unitNumber: unit.unit_number,
    success: true,
    amountGhs,
    trial: false,
  });

  return { ok: true, activated: true, reference: verified.reference };
}

/**
 * Best-effort: seed landlord_subscriptions trial row on approve when missing.
 * Uses ERP_SUITE_TRIAL_DAYS (90). Non-fatal if insert fails (schema mismatch).
 */
export async function ensurePlatformOnlyLandlordTrialSubscription(
  admin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const { data: landlord } = await admin
    .from("landlords")
    .select("landlord_type")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (landlord?.landlord_type !== "platform_only") {
    return;
  }

  const { data: existing } = await admin
    .from("landlord_subscriptions")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (existing) {
    return;
  }

  const trialEnd = new Date();
  trialEnd.setUTCDate(trialEnd.getUTCDate() + ERP_SUITE_TRIAL_DAYS);
  const trialEndsAt = trialEnd.toISOString().slice(0, 10);
  const unitPriceGhs = await getPlatformOnlyUnitActivationPriceGhs(admin);

  const { error } = await admin.from("landlord_subscriptions").insert({
    tenant_id: tenantId,
    tier: "platform",
    status: "trialing",
    trial_ends_at: trialEndsAt,
    active_unit_count: 0,
    extra_unit_price_ghs: unitPriceGhs,
  });

  if (error) {
    console.warn(
      `[platform-only-unit-billing] ensure trial subscription failed for ${tenantId}:`,
      error.message,
    );
  }
}

export function isPlatformOnlyUnitActivationPaystackContext(
  data: Record<string, unknown>,
): boolean {
  const meta = data.metadata;
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta) as Record<string, unknown>;
      return parsed.context === PLATFORM_ONLY_UNIT_ACTIVATION_CONTEXT;
    } catch {
      return false;
    }
  }
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return (meta as Record<string, unknown>).context ===
      PLATFORM_ONLY_UNIT_ACTIVATION_CONTEXT;
  }
  return false;
}

export async function processPlatformOnlyUnitActivationPaystackEvent(
  data: Record<string, unknown>,
): Promise<{ detail: string; ignored?: boolean }> {
  const reference =
    typeof data.reference === "string" ? data.reference.trim() : "";
  if (!reference) {
    return {
      ignored: true,
      detail: "platform_only_unit_activation missing reference — ignored.",
    };
  }

  let meta: Record<string, unknown> = {};
  const rawMeta = data.metadata;
  if (typeof rawMeta === "string") {
    try {
      meta = JSON.parse(rawMeta) as Record<string, unknown>;
    } catch {
      meta = {};
    }
  } else if (rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)) {
    meta = rawMeta as Record<string, unknown>;
  }

  const tenantId =
    typeof meta.tenant_id === "string" ? meta.tenant_id.trim() : "";
  const unitId = typeof meta.unit_id === "string" ? meta.unit_id.trim() : "";
  if (!tenantId || !unitId) {
    return {
      ignored: true,
      detail: `platform_only_unit_activation ${reference} missing tenant_id/unit_id metadata.`,
    };
  }

  const admin = (await import("@/utils/supabase/admin")).createAdminClient();

  const { data: priorSuccess } = await admin
    .from("landlord_unit_activation_charges")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("unit_id", unitId)
    .eq("paystack_reference", reference)
    .eq("charge_status", "success")
    .maybeSingle();

  if (priorSuccess) {
    return {
      detail: `platform_only_unit_activation ${reference} idempotent (already success).`,
    };
  }

  const result = await confirmPlatformOnlyUnitActivationPayment(admin, {
    tenantId,
    unitId,
    reference,
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    detail: `platform_only_unit_activation ${reference} fulfilled for unit ${unitId}.`,
  };
}
