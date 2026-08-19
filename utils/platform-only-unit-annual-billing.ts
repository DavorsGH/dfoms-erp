import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPlatformOnlyUnitAnnualPriceGhs,
} from "@/utils/platform-billing-config";
import {
  buildAnnualPeriodBounds,
  processLandlordRecurringBilling,
  todayIsoDate,
  type LandlordBillingRow,
  type ProcessLandlordRecurringBillingOptions,
  type RecurringBillingDetail,
} from "@/utils/platform-only-unit-recurring-billing";
import { postPlatformAnnualUnitBillingPaystackFinance } from "@/utils/paystack-finance-posting";

export const PLATFORM_ONLY_UNIT_ANNUAL_CONTEXT =
  "platform_only_unit_annual" as const;

export type PlatformUnitAnnualBillingOptions = {
  /** Override today's date (YYYY-MM-DD) for testing. */
  asOfDate?: string;
};

export type PlatformUnitAnnualBillingDetail = RecurringBillingDetail & {
  action?: "renewal_charged" | "pending_flip" | "skipped_not_due";
};

export type PlatformUnitAnnualBillingResult = {
  asOfDate: string;
  pendingFlips: number;
  charged: number;
  skippedTrial: number;
  skippedZeroUnits: number;
  skippedAlreadyBilled: number;
  skippedNotDue: number;
  failed: number;
  errors: number;
  details: PlatformUnitAnnualBillingDetail[];
};

const ANNUAL_LABELS = {
  cycleAdjective: "Annual",
  successTitle: "Annual unit billing charged",
  failureTitle: "Annual unit billing charge failed",
  escalationTitle: "Annual unit billing overdue — action required",
  notificationContextPrefix: "unit-annual-billing",
} as const;

export function buildAnnualBillingReference(
  tenantId: string,
  periodStart: string,
): string {
  const tenantPart = tenantId.replace(/-/g, "").slice(0, 8);
  const datePart = periodStart.replace(/-/g, "");
  return `unit-yr-${tenantPart}-${datePart}`;
}

function buildAnnualTrialSkipReference(
  tenantId: string,
  periodStart: string,
): string {
  return `${buildAnnualBillingReference(tenantId, periodStart)}-trial`;
}

function isAnnualPeriodDue(
  subscription: {
    current_period_end: string | null;
    trial_ends_at: string | null;
    status: string | null;
  },
  asOfDate: string,
): boolean {
  const periodEnd =
    typeof subscription.current_period_end === "string"
      ? subscription.current_period_end.slice(0, 10)
      : null;

  if (periodEnd && periodEnd >= asOfDate) {
    return false;
  }

  const trialEndsAt =
    typeof subscription.trial_ends_at === "string"
      ? subscription.trial_ends_at.slice(0, 10)
      : null;

  if (subscription.status === "trialing" && trialEndsAt && trialEndsAt >= asOfDate) {
    return false;
  }

  if (trialEndsAt && trialEndsAt >= asOfDate) {
    return false;
  }

  return true;
}

async function applyPendingMonthlyFlips(
  admin: SupabaseClient,
  asOfDate: string,
): Promise<{ flipped: number; tenantIds: string[] }> {
  const { data, error } = await admin
    .from("landlord_subscriptions")
    .select("tenant_id, current_period_end")
    .eq("billing_cycle", "annual")
    .eq("pending_billing_cycle", "monthly")
    .not("current_period_end", "is", null)
    .lt("current_period_end", asOfDate);

  if (error) {
    throw new Error(
      `Failed to load pending annual→monthly flips: ${error.message}`,
    );
  }

  const tenantIds: string[] = [];
  for (const row of data ?? []) {
    const tenantId = row.tenant_id as string;
    const { error: updateError } = await admin
      .from("landlord_subscriptions")
      .update({
        billing_cycle: "monthly",
        pending_billing_cycle: null,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", tenantId);

    if (updateError) {
      throw new Error(
        `Failed to flip billing_cycle to monthly for ${tenantId}: ${updateError.message}`,
      );
    }
    tenantIds.push(tenantId);
  }

  return { flipped: tenantIds.length, tenantIds };
}

async function loadAnnualBillingCandidates(
  admin: SupabaseClient,
  asOfDate: string,
): Promise<
  Array<{
    landlord: LandlordBillingRow;
    subscription: {
      tenant_id: string;
      current_period_end: string | null;
      trial_ends_at: string | null;
      status: string | null;
    };
  }>
> {
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
  if (rows.length === 0) {
    return [];
  }

  const tenantIds = rows.map((row) => row.tenant_id);
  const { data: subscriptions, error: subscriptionError } = await admin
    .from("landlord_subscriptions")
    .select("tenant_id, billing_cycle, current_period_end, trial_ends_at, status")
    .in("tenant_id", tenantIds)
    .eq("billing_cycle", "annual");

  if (subscriptionError) {
    throw new Error(
      `Failed to load annual landlord subscriptions: ${subscriptionError.message}`,
    );
  }

  const subscriptionByTenant = new Map(
    (subscriptions ?? []).map((row) => [row.tenant_id as string, row]),
  );

  const candidates: Array<{
    landlord: LandlordBillingRow;
    subscription: {
      tenant_id: string;
      current_period_end: string | null;
      trial_ends_at: string | null;
      status: string | null;
    };
  }> = [];

  for (const landlord of rows) {
    const subscription = subscriptionByTenant.get(landlord.tenant_id);
    if (!subscription) {
      continue;
    }
    candidates.push({
      landlord,
      subscription: subscription as {
        tenant_id: string;
        current_period_end: string | null;
        trial_ends_at: string | null;
        status: string | null;
      },
    });
  }

  return candidates.filter(({ subscription }) =>
    isAnnualPeriodDue(subscription, asOfDate),
  );
}

export async function runPlatformOnlyUnitAnnualBilling(
  options: PlatformUnitAnnualBillingOptions = {},
): Promise<PlatformUnitAnnualBillingResult> {
  const { createAdminClient } = await import("@/utils/supabase/admin");
  const admin = createAdminClient();
  const asOfDate = options.asOfDate?.trim() || todayIsoDate();
  const unitPriceGhs = await getPlatformOnlyUnitAnnualPriceGhs(admin);

  const flipResult = await applyPendingMonthlyFlips(admin, asOfDate);
  const candidates = await loadAnnualBillingCandidates(admin, asOfDate);

  const details: PlatformUnitAnnualBillingDetail[] = [];
  let charged = 0;
  let skippedTrial = 0;
  let skippedZeroUnits = 0;
  let skippedAlreadyBilled = 0;
  let skippedNotDue = 0;
  let failed = 0;
  let errors = 0;

  for (const { landlord } of candidates) {
    const { periodStart, periodEnd } = buildAnnualPeriodBounds(asOfDate);
    const detail = await processLandlordRecurringBilling(admin, landlord, {
      triggerType: "annual_recurring",
      paystackContext: PLATFORM_ONLY_UNIT_ANNUAL_CONTEXT,
      periodKey: periodStart,
      periodLabel: `${periodStart} – ${periodEnd}`,
      periodStart,
      periodEnd,
      unitPriceGhs,
      buildReference: buildAnnualBillingReference,
      buildTrialSkipReference: buildAnnualTrialSkipReference,
      labels: ANNUAL_LABELS,
      paystackMetadataExtra: {
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
      },
      postFinance: async ({ admin: financeAdmin, ...financeOptions }) => {
        await postPlatformAnnualUnitBillingPaystackFinance(financeAdmin, {
          reference: financeOptions.reference,
          transactionAmountGhs: financeOptions.amountGhs,
          paidAt: financeOptions.paidAt,
          landlordTenantId: financeOptions.tenantId,
          activeUnitCount: financeOptions.activeUnitCount,
          unitPriceGhs: financeOptions.unitPriceGhs,
          periodStart: financeOptions.periodKey,
          periodEnd,
        });
      },
    });

    details.push({ ...detail, action: "renewal_charged" });

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

  for (const tenantId of flipResult.tenantIds) {
    details.push({
      tenantId,
      tenantName: tenantId,
      outcome: "skipped_already_billed",
      activeUnitCount: 0,
      amountGhs: 0,
      reference: null,
      action: "pending_flip",
      message: "billing_cycle flipped to monthly at period end",
    });
  }

  return {
    asOfDate,
    pendingFlips: flipResult.flipped,
    charged,
    skippedTrial,
    skippedZeroUnits,
    skippedAlreadyBilled,
    skippedNotDue,
    failed,
    errors,
    details,
  };
}

export async function runPlatformOnlyLandlordAnnualRecurringBillingForTenant(
  admin: SupabaseClient,
  tenantId: string,
  options: PlatformUnitAnnualBillingOptions &
    ProcessLandlordRecurringBillingOptions = {},
): Promise<RecurringBillingDetail> {
  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select(
      "tenant_id, paystack_charge_authorization_code, paystack_charge_authorization_email, notification_phone",
    )
    .eq("tenant_id", tenantId)
    .eq("landlord_type", "platform_only")
    .maybeSingle();

  if (landlordError || !landlord) {
    throw new Error("Platform-only landlord not found.");
  }

  const asOfDate = options.asOfDate?.trim() || todayIsoDate();
  const unitPriceGhs = await getPlatformOnlyUnitAnnualPriceGhs(admin);
  const { periodStart, periodEnd } = buildAnnualPeriodBounds(asOfDate);

  return processLandlordRecurringBilling(
    admin,
    landlord as LandlordBillingRow,
    {
      triggerType: "annual_recurring",
      paystackContext: PLATFORM_ONLY_UNIT_ANNUAL_CONTEXT,
      periodKey: periodStart,
      periodLabel: `${periodStart} – ${periodEnd}`,
      periodStart,
      periodEnd,
      unitPriceGhs,
      buildReference: buildAnnualBillingReference,
      buildTrialSkipReference: buildAnnualTrialSkipReference,
      labels: ANNUAL_LABELS,
      paystackMetadataExtra: {
        billing_period_start: periodStart,
        billing_period_end: periodEnd,
      },
      postFinance: async ({ admin: financeAdmin, ...financeOptions }) => {
        await postPlatformAnnualUnitBillingPaystackFinance(financeAdmin, {
          reference: financeOptions.reference,
          transactionAmountGhs: financeOptions.amountGhs,
          paidAt: financeOptions.paidAt,
          landlordTenantId: financeOptions.tenantId,
          activeUnitCount: financeOptions.activeUnitCount,
          unitPriceGhs: financeOptions.unitPriceGhs,
          periodStart: financeOptions.periodKey,
          periodEnd,
        });
      },
    },
    { dryRun: options.dryRun },
  );
}

export async function chargePlatformOnlyLandlordAnnualCycleNow(
  admin: SupabaseClient,
  tenantId: string,
  asOfDate = todayIsoDate(),
): Promise<RecurringBillingDetail> {
  return runPlatformOnlyLandlordAnnualRecurringBillingForTenant(admin, tenantId, {
    asOfDate,
  });
}

export function isPlatformOnlyUnitAnnualPaystackContext(
  data: Record<string, unknown>,
): boolean {
  const meta = data.metadata;
  if (typeof meta === "string") {
    try {
      const parsed = JSON.parse(meta) as Record<string, unknown>;
      return parsed.context === PLATFORM_ONLY_UNIT_ANNUAL_CONTEXT;
    } catch {
      return false;
    }
  }
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    return (meta as Record<string, unknown>).context ===
      PLATFORM_ONLY_UNIT_ANNUAL_CONTEXT;
  }
  return false;
}

export async function processPlatformOnlyUnitAnnualPaystackEvent(
  data: Record<string, unknown>,
): Promise<{ detail: string; ignored?: boolean }> {
  const reference =
    typeof data.reference === "string" ? data.reference.trim() : "";
  if (!reference) {
    return {
      ignored: true,
      detail: "platform_only_unit_annual missing reference — ignored.",
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
  const periodStart =
    typeof meta.billing_period_start === "string"
      ? meta.billing_period_start.trim()
      : "";
  const periodEnd =
    typeof meta.billing_period_end === "string"
      ? meta.billing_period_end.trim()
      : "";
  if (!tenantId || !periodStart) {
    return {
      ignored: true,
      detail: `platform_only_unit_annual ${reference} missing tenant_id/billing_period_start metadata.`,
    };
  }

  const admin = (await import("@/utils/supabase/admin")).createAdminClient();

  const { data: priorSuccess } = await admin
    .from("landlord_unit_activation_charges")
    .select("id, amount_ghs")
    .eq("tenant_id", tenantId)
    .eq("trigger_type", "annual_recurring")
    .eq("paystack_reference", reference)
    .eq("charge_status", "success")
    .maybeSingle();

  if (!priorSuccess) {
    return {
      ignored: true,
      detail: `platform_only_unit_annual ${reference} no success audit row — cron handles fulfillment.`,
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

  await postPlatformAnnualUnitBillingPaystackFinance(admin, {
    reference,
    transactionAmountGhs: amountGhs,
    paidAt,
    landlordTenantId: tenantId,
    activeUnitCount: Number.isFinite(activeUnitCount) ? activeUnitCount : 0,
    unitPriceGhs: Number.isFinite(unitPriceGhs) ? unitPriceGhs : amountGhs,
    periodStart,
    periodEnd: periodEnd || periodStart,
  });

  return {
    detail: `platform_only_unit_annual ${reference} finance posted (idempotent webhook recovery).`,
  };
}
