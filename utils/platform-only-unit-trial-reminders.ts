import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { insertLandlordPortalNotification } from "@/utils/landlord-portal-notifications";
import {
  getPlatformOnlyUnitActivationPriceGhs,
  getPlatformOnlyUnitAnnualPriceGhs,
} from "@/utils/platform-billing-config";
import {
  countActiveBillingUnits,
  nextFirstOfMonthAfter,
  todayIsoDate,
} from "@/utils/platform-only-unit-recurring-billing";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { sendResendEmail } from "@/utils/resend-email";

export type PlatformUnitTrialReminderOptions = {
  asOfDate?: string;
};

export type PlatformUnitTrialReminderDetail = {
  tenantId: string;
  tenantName: string;
  trialEndsAt: string;
  reminderDays: 14 | 3;
  outcome: "sent" | "skipped_already_sent" | "skipped_no_trial" | "error";
  message?: string;
};

export type PlatformUnitTrialReminderResult = {
  asOfDate: string;
  sent14d: number;
  sent3d: number;
  skipped: number;
  errors: number;
  details: PlatformUnitTrialReminderDetail[];
};

function addCalendarDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDisplayDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function buildFirstChargeSummary(options: {
  billingCycle: string;
  activeUnitCount: number;
  monthlyUnitPriceGhs: number;
  annualUnitPriceGhs: number;
  trialEndsAt: string;
}): { firstChargeDate: string; formula: string } {
  if (options.billingCycle === "annual") {
    const firstChargeDate = addCalendarDaysIso(options.trialEndsAt, 1);
    const amount = options.activeUnitCount * options.annualUnitPriceGhs;
    return {
      firstChargeDate,
      formula: `GHS ${options.annualUnitPriceGhs.toFixed(2)} × ${options.activeUnitCount} active unit${options.activeUnitCount === 1 ? "" : "s"} = GHS ${amount.toFixed(2)} on ${formatDisplayDate(firstChargeDate)}`,
    };
  }

  const firstChargeDate = nextFirstOfMonthAfter(options.trialEndsAt);
  const amount = options.activeUnitCount * options.monthlyUnitPriceGhs;
  return {
    firstChargeDate,
    formula: `GHS ${options.monthlyUnitPriceGhs.toFixed(2)} × ${options.activeUnitCount} active unit${options.activeUnitCount === 1 ? "" : "s"} = GHS ${amount.toFixed(2)} on the first billing date after your trial (${formatDisplayDate(firstChargeDate)})`,
  };
}

async function reminderAlreadySent(
  admin: SupabaseClient,
  tenantId: string,
  title: string,
  trialEndsAt: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("landlord_notifications")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("title", title)
    .ilike("body", `%${trialEndsAt}%`)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      "[platform-only-unit-trial-reminders] idempotency check failed:",
      error.message,
    );
    return false;
  }

  return Boolean(data);
}

async function notifyTrialEndingReminder(options: {
  admin: SupabaseClient;
  tenantId: string;
  tenantName: string;
  tenantEmail: string | null;
  notificationPhone: string | null;
  trialEndsAt: string;
  reminderDays: 14 | 3;
  billingCycle: string;
  firstChargeFormula: string;
}): Promise<void> {
  const title =
    options.reminderDays === 14
      ? "Your platform trial ends in 14 days"
      : "Your platform trial ends in 3 days";
  const context = `trial-ending-${options.reminderDays}d:${options.tenantId}:${options.trialEndsAt}`;
  if (
    await reminderAlreadySent(
      options.admin,
      options.tenantId,
      title,
      options.trialEndsAt,
    )
  ) {
    return;
  }

  const cycleLabel = options.billingCycle === "annual" ? "Annual" : "Monthly";

  const body =
    `Your free trial ends on ${formatDisplayDate(options.trialEndsAt)}. ` +
    `You selected ${cycleLabel} billing. After your trial, your first charge will be: ${options.firstChargeFormula}. ` +
    `Update your payment method or switch billing cycle before the trial ends at Billing settings.`;

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title,
    body,
    actionUrl: "/landlord-portal/administration/billing",
    context,
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
        "[platform-only-unit-trial-reminders] email failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const phone = normalizeGhanaPhone(options.notificationPhone);
  if (phone) {
    const sms = `Davors: Trial ends ${formatDisplayDate(options.trialEndsAt)} (${options.reminderDays}d). ${cycleLabel} billing — ${options.firstChargeFormula}. Update billing settings.`;
    const smsResult = await sendHubtelSms({
      to: phone,
      content: sms,
      tenantName: options.tenantName,
      recipientName: options.tenantName,
    });
    if (!smsResult.ok) {
      console.error(
        "[platform-only-unit-trial-reminders] SMS failed:",
        smsResult.error,
      );
    }
  }
}

export async function runPlatformOnlyUnitTrialReminders(
  options: PlatformUnitTrialReminderOptions = {},
): Promise<PlatformUnitTrialReminderResult> {
  const { createAdminClient } = await import("@/utils/supabase/admin");
  const admin = createAdminClient();
  const asOfDate = options.asOfDate?.trim() || todayIsoDate();

  const reminderTargets = [
    { days: 14 as const, targetDate: addCalendarDaysIso(asOfDate, 14) },
    { days: 3 as const, targetDate: addCalendarDaysIso(asOfDate, 3) },
  ];

  const { data: subscriptions, error } = await admin
    .from("landlord_subscriptions")
    .select("tenant_id, trial_ends_at, billing_cycle, status")
    .eq("status", "trialing")
    .not("trial_ends_at", "is", null);

  if (error) {
    throw new Error(`Failed to load trialing subscriptions: ${error.message}`);
  }

  const monthlyUnitPriceGhs = await getPlatformOnlyUnitActivationPriceGhs(admin);
  const annualUnitPriceGhs = await getPlatformOnlyUnitAnnualPriceGhs(admin);

  const details: PlatformUnitTrialReminderDetail[] = [];
  let sent14d = 0;
  let sent3d = 0;
  let skipped = 0;
  let errors = 0;

  for (const subscription of subscriptions ?? []) {
    const tenantId = subscription.tenant_id as string;
    const trialEndsAt =
      typeof subscription.trial_ends_at === "string"
        ? subscription.trial_ends_at.slice(0, 10)
        : "";
    if (!trialEndsAt) {
      continue;
    }

    const matchingReminder = reminderTargets.find(
      (target) => target.targetDate === trialEndsAt,
    );
    if (!matchingReminder) {
      continue;
    }

    try {
      const [{ data: tenantRow }, { data: landlordRow }] = await Promise.all([
        admin.from("tenants").select("name, email").eq("id", tenantId).maybeSingle(),
        admin
          .from("landlords")
          .select("notification_phone, landlord_type, approval_status")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
      ]);

      if (
        landlordRow?.landlord_type !== "platform_only" ||
        landlordRow.approval_status !== "approved"
      ) {
        details.push({
          tenantId,
          tenantName: tenantRow?.name?.trim() || tenantId,
          trialEndsAt,
          reminderDays: matchingReminder.days,
          outcome: "skipped_no_trial",
        });
        skipped += 1;
        continue;
      }

      const tenantName = tenantRow?.name?.trim() || "Landlord";
      const tenantEmail =
        typeof tenantRow?.email === "string" ? tenantRow.email : null;
      const billingCycle =
        typeof subscription.billing_cycle === "string"
          ? subscription.billing_cycle
          : "monthly";
      const activeUnitCount = await countActiveBillingUnits(admin, tenantId);
      const { formula } = buildFirstChargeSummary({
        billingCycle,
        activeUnitCount,
        monthlyUnitPriceGhs,
        annualUnitPriceGhs,
        trialEndsAt,
      });

      const title =
        matchingReminder.days === 14
          ? "Your platform trial ends in 14 days"
          : "Your platform trial ends in 3 days";
      if (
        await reminderAlreadySent(admin, tenantId, title, trialEndsAt)
      ) {
        details.push({
          tenantId,
          tenantName,
          trialEndsAt,
          reminderDays: matchingReminder.days,
          outcome: "skipped_already_sent",
        });
        skipped += 1;
        continue;
      }

      await notifyTrialEndingReminder({
        admin,
        tenantId,
        tenantName,
        tenantEmail,
        notificationPhone:
          typeof landlordRow.notification_phone === "string"
            ? landlordRow.notification_phone
            : null,
        trialEndsAt,
        reminderDays: matchingReminder.days,
        billingCycle,
        firstChargeFormula: formula,
      });

      details.push({
        tenantId,
        tenantName,
        trialEndsAt,
        reminderDays: matchingReminder.days,
        outcome: "sent",
      });

      if (matchingReminder.days === 14) {
        sent14d += 1;
      } else {
        sent3d += 1;
      }
    } catch (error) {
      details.push({
        tenantId,
        tenantName: tenantId,
        trialEndsAt,
        reminderDays: matchingReminder.days,
        outcome: "error",
        message: error instanceof Error ? error.message : "Reminder failed",
      });
      errors += 1;
    }
  }

  return {
    asOfDate,
    sent14d,
    sent3d,
    skipped,
    errors,
    details,
  };
}
