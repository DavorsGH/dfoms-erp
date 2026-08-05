import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMonthPeriodBounds } from "@/utils/generate-rent-ledger";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { insertLandlordPortalNotification } from "@/utils/landlord-portal-notifications";
import {
  chargePaystackAuthorization,
  ghsToPesewas,
} from "@/utils/paystack";
import { getPlatformOnlyUnitActivationPriceGhs } from "@/utils/platform-billing-config";
import {
  insertUnitActivationChargeAudit,
  isPlatformOnlyLandlordInTrial,
} from "@/utils/platform-only-unit-billing";
import { postPlatformMonthlyUnitBillingPaystackFinance } from "@/utils/paystack-finance-posting";
import { normalizeGhanaPhone, roundGhs } from "@/utils/product-sale-paystack";
import { sendResendEmail } from "@/utils/resend-email";

export const PLATFORM_ONLY_UNIT_MONTHLY_CONTEXT =
  "platform_only_unit_monthly" as const;

export type PlatformUnitMonthlyBillingOptions = {
  billingMonth?: string;
};

export type PlatformUnitMonthlyBillingDetail = {
  tenantId: string;
  tenantName: string;
  outcome:
    | "charged"
    | "skipped_trial"
    | "skipped_zero_units"
    | "skipped_already_billed"
    | "failed"
    | "error";
  activeUnitCount: number;
  amountGhs: number;
  reference: string | null;
  message?: string;
};

export type PlatformUnitMonthlyBillingResult = {
  billingMonth: string;
  periodStart: string;
  periodEnd: string;
  charged: number;
  skippedTrial: number;
  skippedZeroUnits: number;
  skippedAlreadyBilled: number;
  failed: number;
  errors: number;
  details: PlatformUnitMonthlyBillingDetail[];
};

type LandlordBillingRow = {
  tenant_id: string;
  paystack_charge_authorization_code: string | null;
  paystack_charge_authorization_email: string | null;
  notification_phone: string | null;
};

function parseBillingMonth(value: string | undefined): {
  year: number;
  monthIndex: number;
  billingMonth: string;
} {
  if (value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
    if (!match) {
      throw new Error("billingMonth must be YYYY-MM");
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || month < 1 || month > 12) {
      throw new Error("billingMonth must be a valid YYYY-MM");
    }
    return {
      year,
      monthIndex: month - 1,
      billingMonth: `${year}-${String(month).padStart(2, "0")}`,
    };
  }

  const now = new Date();
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  return {
    year,
    monthIndex,
    billingMonth: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
  };
}

export function buildMonthlyBillingReference(
  tenantId: string,
  billingMonth: string,
): string {
  const tenantPart = tenantId.replace(/-/g, "").slice(0, 8);
  const monthPart = billingMonth.replace("-", "");
  return `unit-mo-${tenantPart}-${monthPart}`;
}

function buildMonthlyTrialSkipReference(
  tenantId: string,
  billingMonth: string,
): string {
  return `${buildMonthlyBillingReference(tenantId, billingMonth)}-trial`;
}

export function previousBillingMonth(billingMonth: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(billingMonth.trim());
  if (!match) {
    throw new Error("billingMonth must be YYYY-MM");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseBillingMonthFromMonthlyReference(
  paystackReference: string | null,
): string | null {
  if (!paystackReference) {
    return null;
  }
  const match = /unit-mo-[a-f0-9]{8}-(\d{6})(?:-trial)?$/i.exec(
    paystackReference.trim(),
  );
  if (!match) {
    return null;
  }
  const yyyymm = match[1];
  return `${yyyymm.slice(0, 4)}-${yyyymm.slice(4, 6)}`;
}

async function getDistinctFailedMonthlyBillingMonths(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string[]> {
  const { data, error } = await admin
    .from("landlord_unit_activation_charges")
    .select("paystack_reference")
    .eq("tenant_id", tenantId)
    .eq("trigger_type", "monthly_recurring")
    .eq("charge_status", "failed");

  if (error) {
    throw new Error(
      `Failed to load monthly billing failure history: ${error.message}`,
    );
  }

  const months = new Set<string>();
  for (const row of data ?? []) {
    const month = parseBillingMonthFromMonthlyReference(row.paystack_reference);
    if (month) {
      months.add(month);
    }
  }
  return [...months];
}

async function previousBillingMonthHadFailedMonthlyCharge(
  admin: SupabaseClient,
  tenantId: string,
  billingMonth: string,
): Promise<boolean> {
  const previousMonth = previousBillingMonth(billingMonth);
  const reference = buildMonthlyBillingReference(tenantId, previousMonth);
  const { data, error } = await admin
    .from("landlord_unit_activation_charges")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("trigger_type", "monthly_recurring")
    .eq("charge_status", "failed")
    .eq("paystack_reference", reference)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to check previous monthly billing failure: ${error.message}`,
    );
  }

  return Boolean(data);
}

export async function markLandlordSubscriptionPastDue(
  admin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const { error } = await admin.from("landlord_subscriptions").upsert(
    {
      tenant_id: tenantId,
      status: "past_due",
    },
    { onConflict: "tenant_id" },
  );

  if (error) {
    throw new Error(
      `Failed to mark landlord_subscriptions past_due: ${error.message}`,
    );
  }
}

const MONTHLY_BILLING_ESCALATION_TITLE =
  "Monthly unit billing overdue — action required";

async function escalationReminderAlreadySent(
  admin: SupabaseClient,
  tenantId: string,
  billingMonth: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("landlord_notifications")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("title", MONTHLY_BILLING_ESCALATION_TITLE)
    .ilike("body", `%${billingMonth}%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "[platform-only-unit-monthly-billing] escalation idempotency check failed:",
      error.message,
    );
    return false;
  }

  return Boolean(data);
}

async function notifyMonthlyBillingEscalation(options: {
  admin: SupabaseClient;
  tenantId: string;
  tenantName: string;
  billingMonth: string;
  amountGhs: number;
  tenantEmail: string | null;
}): Promise<void> {
  if (
    await escalationReminderAlreadySent(
      options.admin,
      options.tenantId,
      options.billingMonth,
    )
  ) {
    return;
  }

  const body =
    `Your monthly platform unit billing has failed for two consecutive months ` +
    `(latest: ${options.billingMonth}, GHS ${options.amountGhs.toFixed(2)}). ` +
    `Your units remain active and you keep full portal access, but please update ` +
    `your payment method or contact support to avoid further billing issues. ` +
    `Future billing only — no refunds for prior periods.`;

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title: MONTHLY_BILLING_ESCALATION_TITLE,
    body,
    actionUrl: "/landlord-portal/real-estate/units",
    context: `unit-monthly-billing-escalation:${options.billingMonth}`,
  });

  const email = options.tenantEmail?.trim() ?? "";
  if (!email) {
    return;
  }

  try {
    await sendResendEmail({
      to: email,
      subject: MONTHLY_BILLING_ESCALATION_TITLE,
      html: `<p>Hi ${options.tenantName.replace(/</g, "&lt;").replace(/>/g, "&gt;")},</p><p>${body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p><p>Davors Facilities</p>`,
    });
  } catch (error) {
    console.error(
      "[platform-only-unit-monthly-billing] escalation email failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function handleMonthlyBillingChargeFailure(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    tenantName: string;
    billingMonth: string;
    activeUnitCount: number;
    amountGhs: number;
    unitPriceGhs: number;
    reference: string;
    failureReason: string;
    notificationPhone: string | null;
    tenantEmail: string | null;
  },
): Promise<void> {
  await insertUnitActivationChargeAudit(admin, {
    tenantId: options.tenantId,
    unitId: null,
    amountGhs: options.amountGhs,
    chargeStatus: "failed",
    paystackReference: options.reference,
    failureReason: options.failureReason,
    triggerType: "monthly_recurring",
  });
  await markLandlordSubscriptionPastDue(admin, options.tenantId);
  await notifyMonthlyBillingResult({
    tenantId: options.tenantId,
    tenantName: options.tenantName,
    billingMonth: options.billingMonth,
    activeUnitCount: options.activeUnitCount,
    amountGhs: options.amountGhs,
    unitPriceGhs: options.unitPriceGhs,
    success: false,
    trial: false,
    notificationPhone: options.notificationPhone,
    tenantEmail: options.tenantEmail,
    failureReason: options.failureReason,
  });

  const shouldEscalate = await previousBillingMonthHadFailedMonthlyCharge(
    admin,
    options.tenantId,
    options.billingMonth,
  );
  if (shouldEscalate) {
    await notifyMonthlyBillingEscalation({
      admin,
      tenantId: options.tenantId,
      tenantName: options.tenantName,
      billingMonth: options.billingMonth,
      amountGhs: options.amountGhs,
      tenantEmail: options.tenantEmail,
    });
  }
}

export type PlatformOnlyMonthlyBillingPastDueBanner = {
  show: boolean;
  message: string;
};

/**
 * Persistent banner when past_due and two consecutive monthly billing months failed.
 * Escalation rule: latest failed billing month + immediately prior month both failed.
 */
export async function getPlatformOnlyMonthlyBillingPastDueBanner(
  admin: SupabaseClient,
  tenantId: string,
): Promise<PlatformOnlyMonthlyBillingPastDueBanner | null> {
  const { data: subscription, error: subscriptionError } = await admin
    .from("landlord_subscriptions")
    .select("status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (subscriptionError) {
    console.error(
      "[platform-only-unit-monthly-billing] subscription lookup failed:",
      subscriptionError.message,
    );
    return null;
  }

  if (subscription?.status !== "past_due") {
    return null;
  }

  const failedMonths = await getDistinctFailedMonthlyBillingMonths(
    admin,
    tenantId,
  );
  if (failedMonths.length < 2) {
    return null;
  }

  const latestFailedMonth = [...failedMonths].sort().reverse()[0];
  const priorMonth = previousBillingMonth(latestFailedMonth);
  if (!failedMonths.includes(priorMonth)) {
    return null;
  }

  return {
    show: true,
    message:
      "Monthly unit billing failed for two consecutive months. Your units stay active and you keep full portal access — please update your payment method on the Units page to restore billing.",
  };
}

async function countActiveBillingUnits(
  admin: SupabaseClient,
  tenantId: string,
): Promise<number> {
  const { count, error } = await admin
    .from("property_units")
    .select("unit_id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("billing_activation_status", "active");

  if (error) {
    throw new Error(`Failed to count active billing units: ${error.message}`);
  }

  return count ?? 0;
}

async function hasMonthlyBillingAlreadySettled(
  admin: SupabaseClient,
  tenantId: string,
  billingMonth: string,
): Promise<boolean> {
  const chargeRef = buildMonthlyBillingReference(tenantId, billingMonth);
  const trialRef = buildMonthlyTrialSkipReference(tenantId, billingMonth);

  const { data, error } = await admin
    .from("landlord_unit_activation_charges")
    .select("id, charge_status, paystack_reference")
    .eq("tenant_id", tenantId)
    .eq("trigger_type", "monthly_recurring")
    .in("charge_status", ["success", "skipped_trial"])
    .in("paystack_reference", [chargeRef, trialRef]);

  if (error) {
    throw new Error(`Failed to check monthly billing idempotency: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

async function resolveBillingEmail(
  admin: SupabaseClient,
  tenantId: string,
  authEmail: string | null,
  tenantEmail: string | null,
): Promise<string | null> {
  const stored = authEmail?.trim() ?? "";
  if (stored) {
    return stored;
  }
  const tenant = tenantEmail?.trim() ?? "";
  return tenant || null;
}

async function updateLandlordSubscriptionAfterMonthlyCharge(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    activeUnitCount: number;
    amountGhs: number;
    unitPriceGhs: number;
    periodStart: string;
    periodEnd: string;
  },
): Promise<void> {
  const payload = {
    tenant_id: options.tenantId,
    status: "active" as const,
    active_unit_count: options.activeUnitCount,
    current_period_price_ghs: options.amountGhs,
    current_period_start: options.periodStart,
    current_period_end: options.periodEnd,
    extra_unit_price_ghs: options.unitPriceGhs,
  };

  const { error } = await admin
    .from("landlord_subscriptions")
    .upsert(payload, { onConflict: "tenant_id" });

  if (error) {
    throw new Error(
      `Failed to update landlord_subscriptions after monthly charge: ${error.message}`,
    );
  }
}

async function notifyMonthlyBillingResult(options: {
  tenantId: string;
  tenantName: string;
  billingMonth: string;
  activeUnitCount: number;
  amountGhs: number;
  unitPriceGhs: number;
  success: boolean;
  trial: boolean;
  notificationPhone: string | null;
  tenantEmail: string | null;
  failureReason?: string;
}): Promise<void> {
  const periodLabel = options.billingMonth;
  const unitsLabel =
    options.activeUnitCount === 1
      ? "1 active unit"
      : `${options.activeUnitCount} active units`;

  const title = options.success
    ? options.trial
      ? "Monthly unit billing skipped (trial)"
      : "Monthly unit billing charged"
    : "Monthly unit billing charge failed";

  const body = options.success
    ? options.trial
      ? `No charge for ${periodLabel}. ${unitsLabel} remain active during your free trial (GHS ${options.unitPriceGhs.toFixed(2)}/unit after trial).`
      : `GHS ${options.amountGhs.toFixed(2)} charged for ${periodLabel} (${unitsLabel} × GHS ${options.unitPriceGhs.toFixed(2)}).`
    : `Could not charge GHS ${options.amountGhs.toFixed(2)} for ${periodLabel} (${unitsLabel}): ${options.failureReason ?? "Payment failed."} Update your payment method in unit billing settings.`;

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title,
    body,
    actionUrl: "/landlord-portal/real-estate/units",
    context: `unit-monthly-billing:${periodLabel}`,
  });

  const email = options.tenantEmail?.trim() ?? "";
  if (email) {
    try {
      await sendResendEmail({
        to: email,
        subject: title,
        html: `<p>Hi ${options.tenantName.replace(/</g, "&lt;").replace(/>/g, "&gt;")},</p><p>${body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p><p>Davors Facilities</p>`,
      });
    } catch (error) {
      console.error(
        "[platform-only-unit-monthly-billing] notification email failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const phone = normalizeGhanaPhone(options.notificationPhone);
  if (phone) {
    const sms = options.success
      ? options.trial
        ? `Davors: No monthly unit charge for ${periodLabel} — free trial active (${unitsLabel}).`
        : `Davors: Monthly unit billing GHS ${options.amountGhs.toFixed(2)} charged for ${periodLabel} (${unitsLabel}).`
      : `Davors: Monthly unit billing failed for ${periodLabel} (GHS ${options.amountGhs.toFixed(2)}). Update your payment method.`;

    const smsResult = await sendHubtelSms({ to: phone, content: sms });
    if (!smsResult.ok) {
      console.error(
        "[platform-only-unit-monthly-billing] notification SMS failed:",
        smsResult.error,
      );
    }
  }
}

async function processLandlordMonthlyBilling(
  admin: SupabaseClient,
  row: LandlordBillingRow,
  options: {
    billingMonth: string;
    periodStart: string;
    periodEnd: string;
    unitPriceGhs: number;
  },
): Promise<PlatformUnitMonthlyBillingDetail> {
  const tenantId = row.tenant_id;

  const { data: tenantRow } = await admin
    .from("tenants")
    .select("name, email")
    .eq("id", tenantId)
    .maybeSingle();

  const tenantName = tenantRow?.name?.trim() || "Landlord";
  const tenantEmail =
    typeof tenantRow?.email === "string" ? tenantRow.email : null;

  try {
    const activeUnitCount = await countActiveBillingUnits(admin, tenantId);
    if (activeUnitCount <= 0) {
      return {
        tenantId,
        tenantName,
        outcome: "skipped_zero_units",
        activeUnitCount: 0,
        amountGhs: 0,
        reference: null,
      };
    }

    if (
      await hasMonthlyBillingAlreadySettled(admin, tenantId, options.billingMonth)
    ) {
      return {
        tenantId,
        tenantName,
        outcome: "skipped_already_billed",
        activeUnitCount,
        amountGhs: roundGhs(activeUnitCount * options.unitPriceGhs),
        reference: buildMonthlyBillingReference(tenantId, options.billingMonth),
      };
    }

    const amountGhs = roundGhs(activeUnitCount * options.unitPriceGhs);
    const inTrial = await isPlatformOnlyLandlordInTrial(admin, tenantId);

    if (inTrial) {
      const trialReference = buildMonthlyTrialSkipReference(
        tenantId,
        options.billingMonth,
      );
      await insertUnitActivationChargeAudit(admin, {
        tenantId,
        unitId: null,
        amountGhs,
        chargeStatus: "skipped_trial",
        paystackReference: trialReference,
        failureReason: null,
        triggerType: "monthly_recurring",
      });
      await notifyMonthlyBillingResult({
        tenantId,
        tenantName,
        billingMonth: options.billingMonth,
        activeUnitCount,
        amountGhs,
        unitPriceGhs: options.unitPriceGhs,
        success: true,
        trial: true,
        notificationPhone: row.notification_phone,
        tenantEmail,
      });
      return {
        tenantId,
        tenantName,
        outcome: "skipped_trial",
        activeUnitCount,
        amountGhs,
        reference: trialReference,
      };
    }

    const authCode = row.paystack_charge_authorization_code?.trim() ?? "";
    const authEmail = await resolveBillingEmail(
      admin,
      tenantId,
      row.paystack_charge_authorization_email,
      tenantEmail,
    );
    const reference = buildMonthlyBillingReference(tenantId, options.billingMonth);

    if (!authCode || !authEmail) {
      const failureReason =
        "No stored Paystack authorization on file. Complete a unit activation payment to save a card.";
      await handleMonthlyBillingChargeFailure(admin, {
        tenantId,
        tenantName,
        billingMonth: options.billingMonth,
        activeUnitCount,
        amountGhs,
        unitPriceGhs: options.unitPriceGhs,
        reference,
        failureReason,
        notificationPhone: row.notification_phone,
        tenantEmail,
      });
      return {
        tenantId,
        tenantName,
        outcome: "failed",
        activeUnitCount,
        amountGhs,
        reference,
        message: failureReason,
      };
    }

    const charged = await chargePaystackAuthorization({
      authorizationCode: authCode,
      email: authEmail,
      amountPesewas: ghsToPesewas(amountGhs),
      reference,
      metadata: {
        context: PLATFORM_ONLY_UNIT_MONTHLY_CONTEXT,
        tenant_id: tenantId,
        billing_month: options.billingMonth,
        active_unit_count: activeUnitCount,
        unit_price_ghs: options.unitPriceGhs,
        trigger_type: "monthly_recurring",
      },
    });

    if (!charged.ok) {
      await handleMonthlyBillingChargeFailure(admin, {
        tenantId,
        tenantName,
        billingMonth: options.billingMonth,
        activeUnitCount,
        amountGhs,
        unitPriceGhs: options.unitPriceGhs,
        reference,
        failureReason: charged.error,
        notificationPhone: row.notification_phone,
        tenantEmail,
      });
      return {
        tenantId,
        tenantName,
        outcome: "failed",
        activeUnitCount,
        amountGhs,
        reference,
        message: charged.error,
      };
    }

    const paidAt = new Date().toISOString();
    await insertUnitActivationChargeAudit(admin, {
      tenantId,
      unitId: null,
      amountGhs,
      chargeStatus: "success",
      paystackReference: charged.reference,
      failureReason: null,
      triggerType: "monthly_recurring",
    });
    await postPlatformMonthlyUnitBillingPaystackFinance(admin, {
      reference: charged.reference,
      transactionAmountGhs: amountGhs,
      paidAt,
      landlordTenantId: tenantId,
      activeUnitCount,
      unitPriceGhs: options.unitPriceGhs,
      billingMonth: options.billingMonth,
    });
    await updateLandlordSubscriptionAfterMonthlyCharge(admin, {
      tenantId,
      activeUnitCount,
      amountGhs,
      unitPriceGhs: options.unitPriceGhs,
      periodStart: options.periodStart,
      periodEnd: options.periodEnd,
    });
    await notifyMonthlyBillingResult({
      tenantId,
      tenantName,
      billingMonth: options.billingMonth,
      activeUnitCount,
      amountGhs,
      unitPriceGhs: options.unitPriceGhs,
      success: true,
      trial: false,
      notificationPhone: row.notification_phone,
      tenantEmail,
    });

    return {
      tenantId,
      tenantName,
      outcome: "charged",
      activeUnitCount,
      amountGhs,
      reference: charged.reference,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Monthly billing processing failed.";
    return {
      tenantId,
      tenantName,
      outcome: "error",
      activeUnitCount: 0,
      amountGhs: 0,
      reference: null,
      message,
    };
  }
}

export async function runPlatformOnlyUnitMonthlyBilling(
  options: PlatformUnitMonthlyBillingOptions = {},
): Promise<PlatformUnitMonthlyBillingResult> {
  const { createAdminClient } = await import("@/utils/supabase/admin");
  const admin = createAdminClient();

  const { year, monthIndex, billingMonth } = parseBillingMonth(options.billingMonth);
  const { periodStart, periodEnd } = getMonthPeriodBounds(year, monthIndex);
  const unitPriceGhs = await getPlatformOnlyUnitActivationPriceGhs(admin);

  const { data: landlords, error } = await admin
    .from("landlords")
    .select(
      "tenant_id, paystack_charge_authorization_code, paystack_charge_authorization_email, notification_phone",
    )
    .eq("landlord_type", "platform_only")
    .eq("approval_status", "approved");

  if (error) {
    throw new Error(`Failed to load platform_only landlords: ${error.message}`);
  }

  const rows = (landlords ?? []) as LandlordBillingRow[];
  const details: PlatformUnitMonthlyBillingDetail[] = [];
  let charged = 0;
  let skippedTrial = 0;
  let skippedZeroUnits = 0;
  let skippedAlreadyBilled = 0;
  let failed = 0;
  let errors = 0;

  for (const row of rows) {
    const detail = await processLandlordMonthlyBilling(admin, row, {
      billingMonth,
      periodStart,
      periodEnd,
      unitPriceGhs,
    });
    details.push(detail);

    switch (detail.outcome) {
      case "charged":
        charged += 1;
        break;
      case "skipped_trial":
        skippedTrial += 1;
        break;
      case "skipped_zero_units":
        skippedZeroUnits += 1;
        break;
      case "skipped_already_billed":
        skippedAlreadyBilled += 1;
        break;
      case "failed":
        failed += 1;
        break;
      case "error":
        errors += 1;
        break;
      default:
        break;
    }
  }

  return {
    billingMonth,
    periodStart,
    periodEnd,
    charged,
    skippedTrial,
    skippedZeroUnits,
    skippedAlreadyBilled,
    failed,
    errors,
    details,
  };
}

export function isPlatformOnlyUnitMonthlyPaystackContext(
  data: Record<string, unknown>,
): boolean {
  const meta = data.metadata;
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta) as Record<string, unknown>;
      return parsed.context === PLATFORM_ONLY_UNIT_MONTHLY_CONTEXT;
    } catch {
      return false;
    }
  }
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return (meta as Record<string, unknown>).context ===
      PLATFORM_ONLY_UNIT_MONTHLY_CONTEXT;
  }
  return false;
}

/** Webhook recovery: finance + subscription if cron already wrote audit but webhook arrived first. */
export async function processPlatformOnlyUnitMonthlyPaystackEvent(
  data: Record<string, unknown>,
): Promise<{ detail: string; ignored?: boolean }> {
  const reference =
    typeof data.reference === "string" ? data.reference.trim() : "";
  if (!reference) {
    return {
      ignored: true,
      detail: "platform_only_unit_monthly missing reference — ignored.",
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
  const billingMonth =
    typeof meta.billing_month === "string" ? meta.billing_month.trim() : "";
  if (!tenantId || !billingMonth) {
    return {
      ignored: true,
      detail: `platform_only_unit_monthly ${reference} missing tenant_id/billing_month metadata.`,
    };
  }

  const admin = (await import("@/utils/supabase/admin")).createAdminClient();

  const { data: priorSuccess } = await admin
    .from("landlord_unit_activation_charges")
    .select("id, amount_ghs")
    .eq("tenant_id", tenantId)
    .eq("trigger_type", "monthly_recurring")
    .eq("paystack_reference", reference)
    .eq("charge_status", "success")
    .maybeSingle();

  if (!priorSuccess) {
    return {
      ignored: true,
      detail: `platform_only_unit_monthly ${reference} no success audit row — cron handles fulfillment.`,
    };
  }

  const amountGhs = Number(priorSuccess.amount_ghs);
  const activeUnitCount =
    typeof meta.active_unit_count === "number"
      ? meta.active_unit_count
      : typeof meta.active_unit_count === "string"
        ? Number(meta.active_unit_count)
        : NaN;
  const unitPriceGhs =
    typeof meta.unit_price_ghs === "number"
      ? meta.unit_price_ghs
      : typeof meta.unit_price_ghs === "string"
        ? Number(meta.unit_price_ghs)
        : NaN;

  const paidAt =
    typeof data.paid_at === "string" && data.paid_at.trim()
      ? data.paid_at.trim()
      : new Date().toISOString();

  await postPlatformMonthlyUnitBillingPaystackFinance(admin, {
    reference,
    transactionAmountGhs: amountGhs,
    paidAt,
    landlordTenantId: tenantId,
    activeUnitCount: Number.isFinite(activeUnitCount) ? activeUnitCount : 0,
    unitPriceGhs: Number.isFinite(unitPriceGhs)
      ? unitPriceGhs
      : amountGhs,
    billingMonth,
  });

  return {
    detail: `platform_only_unit_monthly ${reference} finance posted (idempotent webhook recovery).`,
  };
}
