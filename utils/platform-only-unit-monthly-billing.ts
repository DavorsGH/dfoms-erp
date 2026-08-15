import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMonthPeriodBounds } from "@/utils/generate-rent-ledger";
import { getPlatformOnlyUnitActivationPriceGhs } from "@/utils/platform-billing-config";
import { postPlatformMonthlyUnitBillingPaystackFinance } from "@/utils/paystack-finance-posting";
import {
  countActiveBillingUnits,
  markLandlordSubscriptionPastDue,
  nextFirstOfMonthAfter,
  processLandlordRecurringBilling,
  type LandlordBillingRow,
  type RecurringBillingDetail,
} from "@/utils/platform-only-unit-recurring-billing";

export const PLATFORM_ONLY_UNIT_MONTHLY_CONTEXT =
  "platform_only_unit_monthly" as const;

export type PlatformUnitMonthlyBillingOptions = {
  billingMonth?: string;
};

export type PlatformUnitMonthlyBillingDetail = RecurringBillingDetail;

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

const MONTHLY_LABELS = {
  cycleAdjective: "Monthly",
  successTitle: "Monthly unit billing charged",
  failureTitle: "Monthly unit billing charge failed",
  escalationTitle: "Monthly unit billing overdue — action required",
  notificationContextPrefix: "unit-monthly-billing",
} as const;

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

export { markLandlordSubscriptionPastDue };

export type PlatformOnlyMonthlyBillingPastDueBanner = {
  show: boolean;
  message: string;
};

export async function getPlatformOnlyMonthlyBillingPastDueBanner(
  admin: SupabaseClient,
  tenantId: string,
): Promise<PlatformOnlyMonthlyBillingPastDueBanner | null> {
  const { data: subscription, error: subscriptionError } = await admin
    .from("landlord_subscriptions")
    .select("status, billing_cycle")
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

  if (subscription.billing_cycle === "annual") {
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

async function loadMonthlyBillingLandlords(
  admin: SupabaseClient,
): Promise<LandlordBillingRow[]> {
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
    .select("tenant_id, billing_cycle, pending_billing_cycle, current_period_end")
    .in("tenant_id", tenantIds);

  if (subscriptionError) {
    throw new Error(
      `Failed to load landlord subscriptions for monthly billing: ${subscriptionError.message}`,
    );
  }

  const subscriptionByTenant = new Map(
    (subscriptions ?? []).map((row) => [row.tenant_id as string, row]),
  );

  const today = new Date().toISOString().slice(0, 10);

  return rows.filter((row) => {
    const subscription = subscriptionByTenant.get(row.tenant_id);
    if (!subscription) {
      return true;
    }
    if (subscription.billing_cycle === "annual") {
      return false;
    }
    if (
      subscription.pending_billing_cycle === "monthly" &&
      typeof subscription.current_period_end === "string" &&
      subscription.current_period_end >= today
    ) {
      return false;
    }
    return true;
  });
}

export async function runPlatformOnlyUnitMonthlyBilling(
  options: PlatformUnitMonthlyBillingOptions = {},
): Promise<PlatformUnitMonthlyBillingResult> {
  const { createAdminClient } = await import("@/utils/supabase/admin");
  const admin = createAdminClient();

  const { year, monthIndex, billingMonth } = parseBillingMonth(options.billingMonth);
  const { periodStart, periodEnd } = getMonthPeriodBounds(year, monthIndex);
  const unitPriceGhs = await getPlatformOnlyUnitActivationPriceGhs(admin);
  const rows = await loadMonthlyBillingLandlords(admin);

  const details: PlatformUnitMonthlyBillingDetail[] = [];
  let charged = 0;
  let skippedTrial = 0;
  let skippedZeroUnits = 0;
  let skippedAlreadyBilled = 0;
  let failed = 0;
  let errors = 0;

  for (const row of rows) {
    const detail = await processLandlordRecurringBilling(admin, row, {
      triggerType: "monthly_recurring",
      paystackContext: PLATFORM_ONLY_UNIT_MONTHLY_CONTEXT,
      periodKey: billingMonth,
      periodLabel: billingMonth,
      periodStart,
      periodEnd,
      unitPriceGhs,
      buildReference: buildMonthlyBillingReference,
      buildTrialSkipReference: buildMonthlyTrialSkipReference,
      labels: MONTHLY_LABELS,
      paystackMetadataExtra: { billing_month: billingMonth },
      postFinance: async ({ admin: financeAdmin, ...financeOptions }) => {
        await postPlatformMonthlyUnitBillingPaystackFinance(financeAdmin, {
          reference: financeOptions.reference,
          transactionAmountGhs: financeOptions.amountGhs,
          paidAt: financeOptions.paidAt,
          landlordTenantId: financeOptions.tenantId,
          activeUnitCount: financeOptions.activeUnitCount,
          unitPriceGhs: financeOptions.unitPriceGhs,
          billingMonth: financeOptions.periodKey,
        });
      },
      previousPeriodHadFailedCharge: previousBillingMonthHadFailedMonthlyCharge,
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
    unitPriceGhs: Number.isFinite(unitPriceGhs) ? unitPriceGhs : amountGhs,
    billingMonth,
  });

  return {
    detail: `platform_only_unit_monthly ${reference} finance posted (idempotent webhook recovery).`,
  };
}

export { countActiveBillingUnits, nextFirstOfMonthAfter };
