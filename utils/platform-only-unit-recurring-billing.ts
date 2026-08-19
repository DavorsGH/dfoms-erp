import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { insertLandlordPortalNotification } from "@/utils/landlord-portal-notifications";
import {
  chargePaystackAuthorization,
  ghsToPesewas,
} from "@/utils/paystack";
import {
  insertUnitActivationChargeAudit,
  isPlatformOnlyLandlordInTrial,
  countActiveBillingUnits,
  type UnitActivationTriggerType,
} from "@/utils/platform-only-unit-billing";
import { getPlatformOnlyUnitCap } from "@/utils/platform-billing-config";
import { normalizeGhanaPhone, roundGhs } from "@/utils/product-sale-paystack";
import { sendResendEmail } from "@/utils/resend-email";

export type LandlordBillingRow = {
  tenant_id: string;
  paystack_charge_authorization_code: string | null;
  paystack_charge_authorization_email: string | null;
  notification_phone: string | null;
};

export type RecurringBillingOutcome =
  | "charged"
  | "skipped_trial"
  | "skipped_zero_units"
  | "skipped_already_billed"
  | "failed"
  | "error";

export type RecurringBillingDetail = {
  tenantId: string;
  tenantName: string;
  outcome: RecurringBillingOutcome;
  activeUnitCount: number;
  billableUnitCount?: number;
  unitCap?: number;
  unitPriceGhs?: number;
  amountGhs: number;
  reference: string | null;
  message?: string;
  dryRun?: boolean;
};

export type ProcessLandlordRecurringBillingOptions = {
  /** When true, resolve billing math and idempotency only — no Paystack, audit, or notifications. */
  dryRun?: boolean;
};

export type RecurringBillingCycleLabels = {
  cycleAdjective: string;
  successTitle: string;
  failureTitle: string;
  escalationTitle: string;
  notificationContextPrefix: string;
};

export type RecurringBillingRunConfig = {
  triggerType: UnitActivationTriggerType;
  paystackContext: string;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  unitPriceGhs: number;
  buildReference: (tenantId: string, periodKey: string) => string;
  buildTrialSkipReference: (tenantId: string, periodKey: string) => string;
  labels: RecurringBillingCycleLabels;
  paystackMetadataExtra?: Record<string, string | number>;
  postFinance: (options: {
    admin: SupabaseClient;
    reference: string;
    amountGhs: number;
    paidAt: string;
    tenantId: string;
    activeUnitCount: number;
    unitPriceGhs: number;
    periodKey: string;
  }) => Promise<void>;
  previousPeriodHadFailedCharge?: (
    admin: SupabaseClient,
    tenantId: string,
    periodKey: string,
  ) => Promise<boolean>;
};

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addCalendarDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** First calendar-month start strictly after isoDate (UTC). */
export function nextFirstOfMonthAfter(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new Error("isoDate must be YYYY-MM-DD");
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, 1));
  date.setUTCMonth(date.getUTCMonth() + 1, 1);
  return date.toISOString().slice(0, 10);
}

/** Annual paid period: start today, end today + 1 year − 1 day. */
export function buildAnnualPeriodBounds(startDate = todayIsoDate()): {
  periodStart: string;
  periodEnd: string;
} {
  const periodStart = startDate;
  const periodEnd = addCalendarDaysIso(
    addCalendarDaysIso(startDate, 365),
    -1,
  );
  return { periodStart, periodEnd };
}

export async function resolveBillableActiveUnitCount(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{
  activeUnitCount: number;
  billableUnitCount: number;
  unitCap: number;
}> {
  const [activeUnitCount, unitCap] = await Promise.all([
    countActiveBillingUnits(admin, tenantId),
    getPlatformOnlyUnitCap(admin),
  ]);

  return {
    activeUnitCount,
    billableUnitCount: Math.min(activeUnitCount, unitCap),
    unitCap,
  };
}

export { countActiveBillingUnits };

export async function resolveBillingEmail(
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

export async function markLandlordSubscriptionPastDue(
  admin: SupabaseClient,
  tenantId: string,
): Promise<void> {
  const { error } = await admin
    .from("landlord_subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(
      `Failed to mark landlord_subscriptions past_due: ${error.message}`,
    );
  }
}

async function hasRecurringBillingAlreadySettled(
  admin: SupabaseClient,
  tenantId: string,
  triggerType: UnitActivationTriggerType,
  references: string[],
): Promise<boolean> {
  const { data, error } = await admin
    .from("landlord_unit_activation_charges")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("trigger_type", triggerType)
    .in("charge_status", ["success", "skipped_trial"])
    .in("paystack_reference", references);

  if (error) {
    throw new Error(`Failed to check recurring billing idempotency: ${error.message}`);
  }

  return (data?.length ?? 0) > 0;
}

async function escalationReminderAlreadySent(
  admin: SupabaseClient,
  tenantId: string,
  title: string,
  periodLabel: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("landlord_notifications")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("title", title)
    .ilike("body", `%${periodLabel}%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "[platform-only-unit-recurring-billing] escalation idempotency check failed:",
      error.message,
    );
    return false;
  }

  return Boolean(data);
}

async function notifyRecurringBillingEscalation(options: {
  admin: SupabaseClient;
  tenantId: string;
  tenantName: string;
  periodLabel: string;
  amountGhs: number;
  tenantEmail: string | null;
  labels: RecurringBillingCycleLabels;
}): Promise<void> {
  if (
    await escalationReminderAlreadySent(
      options.admin,
      options.tenantId,
      options.labels.escalationTitle,
      options.periodLabel,
    )
  ) {
    return;
  }

  const body =
    `Your ${options.labels.cycleAdjective} platform unit billing has failed for two consecutive periods ` +
    `(latest: ${options.periodLabel}, GHS ${options.amountGhs.toFixed(2)}). ` +
    `Your units remain active and you keep full portal access, but please update ` +
    `your payment method or contact support to avoid further billing issues. ` +
    `Future billing only — no refunds for prior periods.`;

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title: options.labels.escalationTitle,
    body,
    actionUrl: "/landlord-portal/administration/billing",
    context: `${options.labels.notificationContextPrefix}-escalation:${options.periodLabel}`,
  });

  const email = options.tenantEmail?.trim() ?? "";
  if (!email) {
    return;
  }

  try {
    await sendResendEmail({
      to: email,
      subject: options.labels.escalationTitle,
      html: `<p>Hi ${options.tenantName.replace(/</g, "&lt;").replace(/>/g, "&gt;")},</p><p>${body.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p><p>Davors Facilities</p>`,
    });
  } catch (error) {
    console.error(
      "[platform-only-unit-recurring-billing] escalation email failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

async function notifyRecurringBillingResult(options: {
  tenantId: string;
  tenantName: string;
  periodLabel: string;
  activeUnitCount: number;
  amountGhs: number;
  unitPriceGhs: number;
  success: boolean;
  trial: boolean;
  notificationPhone: string | null;
  tenantEmail: string | null;
  failureReason?: string;
  labels: RecurringBillingCycleLabels;
}): Promise<void> {
  const unitsLabel =
    options.activeUnitCount === 1
      ? "1 active unit"
      : `${options.activeUnitCount} active units`;

  const title = options.success
    ? options.trial
      ? `${options.labels.cycleAdjective} unit billing skipped (trial)`
      : options.labels.successTitle
    : options.labels.failureTitle;

  const body = options.success
    ? options.trial
      ? `No charge for ${options.periodLabel}. ${unitsLabel} remain active during your free trial (GHS ${options.unitPriceGhs.toFixed(2)}/unit after trial).`
      : `GHS ${options.amountGhs.toFixed(2)} charged for ${options.periodLabel} (${unitsLabel} × GHS ${options.unitPriceGhs.toFixed(2)}).`
    : `Could not charge GHS ${options.amountGhs.toFixed(2)} for ${options.periodLabel} (${unitsLabel}): ${options.failureReason ?? "Payment failed."} Update your payment method in billing settings.`;

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title,
    body,
    actionUrl: "/landlord-portal/administration/billing",
    context: `${options.labels.notificationContextPrefix}:${options.periodLabel}`,
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
        "[platform-only-unit-recurring-billing] notification email failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const phone = normalizeGhanaPhone(options.notificationPhone);
  if (phone) {
    const sms = options.success
      ? options.trial
        ? `Davors: No ${options.labels.cycleAdjective.toLowerCase()} unit charge for ${options.periodLabel} — free trial active (${unitsLabel}).`
        : `Davors: ${options.labels.cycleAdjective} unit billing GHS ${options.amountGhs.toFixed(2)} charged for ${options.periodLabel} (${unitsLabel}).`
      : `Davors: ${options.labels.cycleAdjective} unit billing failed for ${options.periodLabel} (GHS ${options.amountGhs.toFixed(2)}). Update your payment method.`;

    const smsResult = await sendHubtelSms({
      to: phone,
      content: sms,
      tenantName: options.tenantName,
      recipientName: options.tenantName,
    });
    if (!smsResult.ok) {
      console.error(
        "[platform-only-unit-recurring-billing] notification SMS failed:",
        smsResult.error,
      );
    }
  }
}

async function handleRecurringBillingChargeFailure(
  admin: SupabaseClient,
  config: RecurringBillingRunConfig,
  options: {
    tenantId: string;
    tenantName: string;
    activeUnitCount: number;
    amountGhs: number;
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
    triggerType: config.triggerType,
  });
  await markLandlordSubscriptionPastDue(admin, options.tenantId);
  await notifyRecurringBillingResult({
    tenantId: options.tenantId,
    tenantName: options.tenantName,
    periodLabel: config.periodLabel,
    activeUnitCount: options.activeUnitCount,
    amountGhs: options.amountGhs,
    unitPriceGhs: config.unitPriceGhs,
    success: false,
    trial: false,
    notificationPhone: options.notificationPhone,
    tenantEmail: options.tenantEmail,
    failureReason: options.failureReason,
    labels: config.labels,
  });

  if (config.previousPeriodHadFailedCharge) {
    const shouldEscalate = await config.previousPeriodHadFailedCharge(
      admin,
      options.tenantId,
      config.periodKey,
    );
    if (shouldEscalate) {
      await notifyRecurringBillingEscalation({
        admin,
        tenantId: options.tenantId,
        tenantName: options.tenantName,
        periodLabel: config.periodLabel,
        amountGhs: options.amountGhs,
        tenantEmail: options.tenantEmail,
        labels: config.labels,
      });
    }
  }
}

export async function updateLandlordSubscriptionAfterRecurringCharge(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    activeUnitCount: number;
    amountGhs: number;
    unitPriceGhs: number;
    periodStart: string;
    periodEnd: string;
    billingCycle: "monthly" | "annual";
  },
): Promise<void> {
  const { data: existing, error: existingError } = await admin
    .from("landlord_subscriptions")
    .select("status, activated_at")
    .eq("tenant_id", options.tenantId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Failed to load landlord_subscriptions before recurring charge update: ${existingError.message}`,
    );
  }

  const payload: Record<string, unknown> = {
    tenant_id: options.tenantId,
    status: "active" as const,
    active_unit_count: options.activeUnitCount,
    current_period_price_ghs: options.amountGhs,
    current_period_start: options.periodStart,
    current_period_end: options.periodEnd,
    extra_unit_price_ghs: options.unitPriceGhs,
    billing_cycle: options.billingCycle,
    pending_billing_cycle: null,
    updated_at: new Date().toISOString(),
  };

  if (
    existing?.status === "trialing" &&
    (existing.activated_at == null || existing.activated_at === "")
  ) {
    payload.activated_at = new Date().toISOString();
  }

  const { error } = await admin
    .from("landlord_subscriptions")
    .update(payload)
    .eq("tenant_id", options.tenantId);

  if (error) {
    throw new Error(
      `Failed to update landlord_subscriptions after recurring charge: ${error.message}`,
    );
  }
}

export async function processLandlordRecurringBilling(
  admin: SupabaseClient,
  row: LandlordBillingRow,
  config: RecurringBillingRunConfig,
  options: ProcessLandlordRecurringBillingOptions = {},
): Promise<RecurringBillingDetail> {
  const tenantId = row.tenant_id;
  const dryRun = options.dryRun === true;

  const { data: tenantRow } = await admin
    .from("tenants")
    .select("name, email")
    .eq("id", tenantId)
    .maybeSingle();

  const tenantName = tenantRow?.name?.trim() || "Landlord";
  const tenantEmail =
    typeof tenantRow?.email === "string" ? tenantRow.email : null;

  try {
    const { activeUnitCount, billableUnitCount, unitCap } =
      await resolveBillableActiveUnitCount(admin, tenantId);
    const detailBase = {
      tenantId,
      tenantName,
      activeUnitCount,
      billableUnitCount,
      unitCap,
      unitPriceGhs: config.unitPriceGhs,
      dryRun: dryRun || undefined,
    };

    if (billableUnitCount <= 0) {
      return {
        ...detailBase,
        outcome: "skipped_zero_units",
        amountGhs: 0,
        reference: null,
      };
    }

    const chargeRef = config.buildReference(tenantId, config.periodKey);
    const trialRef = config.buildTrialSkipReference(tenantId, config.periodKey);

    if (
      await hasRecurringBillingAlreadySettled(admin, tenantId, config.triggerType, [
        chargeRef,
        trialRef,
      ])
    ) {
      return {
        ...detailBase,
        outcome: "skipped_already_billed",
        amountGhs: roundGhs(billableUnitCount * config.unitPriceGhs),
        reference: chargeRef,
        message: dryRun
          ? "Dry run — period already settled in audit (no duplicate rows would be created)."
          : undefined,
      };
    }

    const amountGhs = roundGhs(billableUnitCount * config.unitPriceGhs);
    const inTrial = await isPlatformOnlyLandlordInTrial(admin, tenantId);

    if (dryRun) {
      if (inTrial) {
        return {
          ...detailBase,
          outcome: "skipped_trial",
          amountGhs,
          reference: trialRef,
          message:
            "Dry run — landlord in trial; no charge or audit row would be written.",
        };
      }

      const authCode = row.paystack_charge_authorization_code?.trim() ?? "";
      const authEmail = await resolveBillingEmail(
        admin,
        tenantId,
        row.paystack_charge_authorization_email,
        tenantEmail,
      );

      if (!authCode || !authEmail) {
        const failureReason =
          "No stored Paystack authorization on file. Complete a unit activation payment to save a card.";
        return {
          ...detailBase,
          outcome: "failed",
          amountGhs,
          reference: chargeRef,
          message: `Dry run — would fail before Paystack: ${failureReason}`,
        };
      }

      return {
        ...detailBase,
        outcome: "charged",
        amountGhs,
        reference: chargeRef,
        message:
          "Dry run — Paystack charge_authorization would be called with this amount and reference.",
      };
    }

    if (inTrial) {
      await insertUnitActivationChargeAudit(admin, {
        tenantId,
        unitId: null,
        amountGhs,
        chargeStatus: "skipped_trial",
        paystackReference: trialRef,
        failureReason: null,
        triggerType: config.triggerType,
      });
      await notifyRecurringBillingResult({
        tenantId,
        tenantName,
        periodLabel: config.periodLabel,
        activeUnitCount: billableUnitCount,
        amountGhs,
        unitPriceGhs: config.unitPriceGhs,
        success: true,
        trial: true,
        notificationPhone: row.notification_phone,
        tenantEmail,
        labels: config.labels,
      });
      return {
        ...detailBase,
        outcome: "skipped_trial",
        amountGhs,
        reference: trialRef,
      };
    }

    const authCode = row.paystack_charge_authorization_code?.trim() ?? "";
    const authEmail = await resolveBillingEmail(
      admin,
      tenantId,
      row.paystack_charge_authorization_email,
      tenantEmail,
    );

    if (!authCode || !authEmail) {
      const failureReason =
        "No stored Paystack authorization on file. Complete a unit activation payment to save a card.";
      await handleRecurringBillingChargeFailure(admin, config, {
        tenantId,
        tenantName,
        activeUnitCount: billableUnitCount,
        amountGhs,
        reference: chargeRef,
        failureReason,
        notificationPhone: row.notification_phone,
        tenantEmail,
      });
      return {
        ...detailBase,
        outcome: "failed",
        amountGhs,
        reference: chargeRef,
        message: failureReason,
      };
    }

    const charged = await chargePaystackAuthorization({
      authorizationCode: authCode,
      email: authEmail,
      amountPesewas: ghsToPesewas(amountGhs),
      reference: chargeRef,
      metadata: {
        context: config.paystackContext,
        tenant_id: tenantId,
        active_unit_count: billableUnitCount,
        total_active_unit_count: activeUnitCount,
        unit_price_ghs: config.unitPriceGhs,
        trigger_type: config.triggerType,
        ...config.paystackMetadataExtra,
      },
    });

    if (!charged.ok) {
      await handleRecurringBillingChargeFailure(admin, config, {
        tenantId,
        tenantName,
        activeUnitCount: billableUnitCount,
        amountGhs,
        reference: chargeRef,
        failureReason: charged.error,
        notificationPhone: row.notification_phone,
        tenantEmail,
      });
      return {
        ...detailBase,
        outcome: "failed",
        amountGhs,
        reference: chargeRef,
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
      triggerType: config.triggerType,
    });
    await config.postFinance({
      admin,
      reference: charged.reference,
      amountGhs,
      paidAt,
      tenantId,
      activeUnitCount: billableUnitCount,
      unitPriceGhs: config.unitPriceGhs,
      periodKey: config.periodKey,
    });
    await updateLandlordSubscriptionAfterRecurringCharge(admin, {
      tenantId,
      activeUnitCount,
      amountGhs,
      unitPriceGhs: config.unitPriceGhs,
      periodStart: config.periodStart,
      periodEnd: config.periodEnd,
      billingCycle:
        config.triggerType === "annual_recurring" ? "annual" : "monthly",
    });
    await notifyRecurringBillingResult({
      tenantId,
      tenantName,
      periodLabel: config.periodLabel,
      activeUnitCount: billableUnitCount,
      amountGhs,
      unitPriceGhs: config.unitPriceGhs,
      success: true,
      trial: false,
      notificationPhone: row.notification_phone,
      tenantEmail,
      labels: config.labels,
    });

    return {
      ...detailBase,
      outcome: "charged",
      amountGhs,
      reference: charged.reference,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Recurring billing processing failed.";
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

export async function chargeLandlordRecurringBillingNow(
  admin: SupabaseClient,
  row: LandlordBillingRow,
  config: RecurringBillingRunConfig,
  options: ProcessLandlordRecurringBillingOptions = {},
): Promise<RecurringBillingDetail> {
  return processLandlordRecurringBilling(admin, row, config, options);
}
