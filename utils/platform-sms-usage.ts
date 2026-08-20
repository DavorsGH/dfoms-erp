import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchHubtelAccountProfile } from "@/utils/hubtel-account";
import { fetchHubtelReportedOutboundSendCount } from "@/utils/hubtel-sms-reporting";
import type {
  PlatformHubtelBalanceSummary,
  PlatformHubtelReportedSendsSummary,
  PlatformSmsPeriodBreakdown,
  PlatformSmsTenantBreakdown,
  PlatformSmsTransactionalLogSummary,
  PlatformSmsUsageReport,
  SmsUsagePeriodKey,
} from "@/utils/platform-sms-usage-types";

type SmsCreditTransactionRow = {
  tenant_id: string;
  delta: number;
  reason: string;
  created_at: string;
};

type TenantRow = {
  id: string;
  name: string | null;
  tenant_code: string | null;
};

type SendClassification = {
  totalSends: number;
  allowanceSends: number;
  paidSends: number;
  allowanceCreditsGranted: number;
  paidCreditsPurchased: number;
};

type TenantAccumulator = SendClassification & {
  tenantId: string;
};

const PERIOD_LABELS: Record<SmsUsagePeriodKey, string> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  all_time: "All time",
};

function startOfUtcDay(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function isWithinPeriod(
  createdAtIso: string,
  period: SmsUsagePeriodKey,
  now: Date,
): boolean {
  if (period === "all_time") {
    return true;
  }

  const createdAt = new Date(createdAtIso);
  if (Number.isNaN(createdAt.getTime())) {
    return false;
  }

  if (period === "today") {
    return createdAt >= startOfUtcDay(now);
  }

  const days = period === "last_7_days" ? 7 : 30;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return createdAt >= cutoff;
}

function emptyClassification(): SendClassification {
  return {
    totalSends: 0,
    allowanceSends: 0,
    paidSends: 0,
    allowanceCreditsGranted: 0,
    paidCreditsPurchased: 0,
  };
}

function classifySend(
  state: { allowancePool: number; paidPool: number },
  sendCount: number,
): { allowanceSends: number; paidSends: number } {
  let allowanceSends = 0;
  let paidSends = 0;

  for (let index = 0; index < sendCount; index += 1) {
    if (state.allowancePool > 0) {
      state.allowancePool -= 1;
      allowanceSends += 1;
    } else if (state.paidPool > 0) {
      state.paidPool -= 1;
      paidSends += 1;
    } else {
      allowanceSends += 1;
    }
  }

  return { allowanceSends, paidSends };
}

function applyTransaction(
  state: { allowancePool: number; paidPool: number },
  row: SmsCreditTransactionRow,
): SendClassification | null {
  const delta = Number(row.delta) || 0;

  if (row.reason === "purchase" && delta > 0) {
    state.paidPool += delta;
    return {
      totalSends: 0,
      allowanceSends: 0,
      paidSends: 0,
      allowanceCreditsGranted: 0,
      paidCreditsPurchased: delta,
    };
  }

  if (row.reason === "monthly_allowance_reset" && delta > 0) {
    state.allowancePool += delta;
    return {
      totalSends: 0,
      allowanceSends: 0,
      paidSends: 0,
      allowanceCreditsGranted: delta,
      paidCreditsPurchased: 0,
    };
  }

  if (row.reason === "adjustment") {
    if (delta >= 0) {
      state.paidPool += delta;
    } else {
      const remaining = state.paidPool + delta;
      state.paidPool = Math.max(0, remaining);
    }
    return null;
  }

  if (row.reason === "send") {
    const sendCount = Math.abs(delta) || 1;
    const split = classifySend(state, sendCount);
    return {
      totalSends: sendCount,
      allowanceSends: split.allowanceSends,
      paidSends: split.paidSends,
      allowanceCreditsGranted: 0,
      paidCreditsPurchased: 0,
    };
  }

  return null;
}

function accumulateClassification(
  target: SendClassification,
  delta: SendClassification,
) {
  target.totalSends += delta.totalSends;
  target.allowanceSends += delta.allowanceSends;
  target.paidSends += delta.paidSends;
  target.allowanceCreditsGranted += delta.allowanceCreditsGranted;
  target.paidCreditsPurchased += delta.paidCreditsPurchased;
}

async function loadAllSmsCreditTransactions(
  admin: SupabaseClient,
): Promise<SmsCreditTransactionRow[]> {
  const pageSize = 1000;
  const rows: SmsCreditTransactionRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from("sms_credit_transactions")
      .select("tenant_id, delta, reason, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(error.message);
    }

    const batch = (data as SmsCreditTransactionRow[] | null) ?? [];
    rows.push(...batch);

    if (batch.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return rows;
}

async function loadTransactionalSmsLogCount(
  admin: SupabaseClient,
): Promise<PlatformSmsTransactionalLogSummary> {
  const { count, error } = await admin
    .from("transactional_notification_sms_log")
    .select("id", { count: "exact", head: true });

  if (error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find the table")
    ) {
      return {
        available: false,
        totalLogged: 0,
        ledgerSendCount: 0,
        discrepancy: 0,
        note: "transactional_notification_sms_log is not deployed on this environment yet.",
      };
    }

    return {
      available: false,
      totalLogged: 0,
      ledgerSendCount: 0,
      discrepancy: 0,
      note: error.message,
    };
  }

  return {
    available: true,
    totalLogged: count ?? 0,
    ledgerSendCount: 0,
    discrepancy: 0,
    note: null,
  };
}

export async function fetchPlatformSmsUsageReport(
  admin: SupabaseClient,
): Promise<PlatformSmsUsageReport> {
  const now = new Date();
  const [
    transactions,
    tenantsResult,
    transactionalLogBase,
    hubtelProfile,
    hubtelReporting,
  ] = await Promise.all([
    loadAllSmsCreditTransactions(admin),
    admin.from("tenants").select("id, name, tenant_code"),
    loadTransactionalSmsLogCount(admin),
    fetchHubtelAccountProfile(),
    fetchHubtelReportedOutboundSendCount(),
  ]);

  if (tenantsResult.error) {
    throw new Error(tenantsResult.error.message);
  }

  const tenantById = new Map<string, TenantRow>(
    ((tenantsResult.data as TenantRow[] | null) ?? []).map((tenant) => [
      tenant.id,
      tenant,
    ]),
  );

  const byTenant = new Map<string, TenantAccumulator>();
  const periodTotals = new Map<SmsUsagePeriodKey, SendClassification>();
  const overall = emptyClassification();

  for (const period of Object.keys(PERIOD_LABELS) as SmsUsagePeriodKey[]) {
    periodTotals.set(period, emptyClassification());
  }

  const grouped = new Map<string, SmsCreditTransactionRow[]>();
  for (const row of transactions) {
    const list = grouped.get(row.tenant_id) ?? [];
    list.push(row);
    grouped.set(row.tenant_id, list);
  }

  for (const [tenantId, tenantRows] of grouped) {
    const pool = { allowancePool: 0, paidPool: 0 };
    const tenantTotals = emptyClassification();

    if (!byTenant.has(tenantId)) {
      byTenant.set(tenantId, {
        tenantId,
        ...emptyClassification(),
      });
    }

    for (const row of tenantRows) {
      const effect = applyTransaction(pool, row);
      if (!effect) {
        continue;
      }

      accumulateClassification(tenantTotals, effect);
      accumulateClassification(overall, effect);

      if (row.reason === "send") {
        for (const period of Object.keys(PERIOD_LABELS) as SmsUsagePeriodKey[]) {
          if (!isWithinPeriod(row.created_at, period, now)) {
            continue;
          }

          const periodBucket = periodTotals.get(period)!;
          periodBucket.totalSends += effect.totalSends;
          periodBucket.allowanceSends += effect.allowanceSends;
          periodBucket.paidSends += effect.paidSends;
        }
      } else {
        for (const period of Object.keys(PERIOD_LABELS) as SmsUsagePeriodKey[]) {
          if (!isWithinPeriod(row.created_at, period, now)) {
            continue;
          }

          const periodBucket = periodTotals.get(period)!;
          periodBucket.allowanceCreditsGranted += effect.allowanceCreditsGranted;
          periodBucket.paidCreditsPurchased += effect.paidCreditsPurchased;
        }
      }
    }

    const tenantAccumulator = byTenant.get(tenantId)!;
    accumulateClassification(tenantAccumulator, tenantTotals);
  }

  const ledgerSendCount = overall.totalSends;
  const transactionalLog: PlatformSmsTransactionalLogSummary = {
    ...transactionalLogBase,
    ledgerSendCount,
    discrepancy: transactionalLogBase.available
      ? (transactionalLogBase.totalLogged ?? 0) - ledgerSendCount
      : 0,
    note: transactionalLogBase.available
      ? transactionalLogBase.note
      : transactionalLogBase.note,
  };

  const hubtelBalance: PlatformHubtelBalanceSummary = {
    available: hubtelProfile.available && hubtelProfile.balance !== null,
    balance: hubtelProfile.balance,
    currency: hubtelProfile.currency,
    accountLabel: hubtelProfile.accountLabel,
    endpoint: hubtelProfile.endpoint,
    configuredClientId: hubtelProfile.configuredClientId,
    configuredClientIdLabel: hubtelProfile.configuredClientIdLabel,
    error: hubtelProfile.error,
  };

  const hubtelReportedSends: PlatformHubtelReportedSendsSummary = {
    available: hubtelReporting.available,
    outboundSendCount: hubtelReporting.outboundSendCount,
    ledgerSendCount,
    discrepancy: hubtelReporting.available
      ? (hubtelReporting.outboundSendCount ?? 0) - ledgerSendCount
      : 0,
    endpoint: hubtelReporting.endpoint,
    configuredClientId: hubtelReporting.configuredClientId,
    configuredClientIdLabel: hubtelReporting.configuredClientIdLabel,
    error: hubtelReporting.error,
  };

  const perTenant: PlatformSmsTenantBreakdown[] = [...byTenant.values()]
    .map((entry) => {
      const tenant = tenantById.get(entry.tenantId);
      return {
        tenantId: entry.tenantId,
        tenantName: tenant?.name?.trim() || entry.tenantId,
        tenantCode: tenant?.tenant_code ?? null,
        totalSends: entry.totalSends,
        allowanceSends: entry.allowanceSends,
        paidSends: entry.paidSends,
        allowanceCreditsGranted: entry.allowanceCreditsGranted,
        paidCreditsPurchased: entry.paidCreditsPurchased,
      };
    })
    .sort((left, right) => right.totalSends - left.totalSends);

  const periodBreakdown: PlatformSmsPeriodBreakdown[] = (
    Object.keys(PERIOD_LABELS) as SmsUsagePeriodKey[]
  ).map((period) => {
    const bucket = periodTotals.get(period)!;
    return {
      period,
      label: PERIOD_LABELS[period],
      totalSends: bucket.totalSends,
      allowanceSends: bucket.allowanceSends,
      paidSends: bucket.paidSends,
    };
  });

  return {
    generatedAt: now.toISOString(),
    totals: {
      totalSends: overall.totalSends,
      allowanceSends: overall.allowanceSends,
      paidSends: overall.paidSends,
      allowanceCreditsGranted: overall.allowanceCreditsGranted,
      paidCreditsPurchased: overall.paidCreditsPurchased,
    },
    periodBreakdown,
    perTenant,
    transactionalLog,
    hubtelBalance,
    hubtelReportedSends,
    notes: [
      "Counts reflect sms_credit_transactions reason='send' — each row is one real Hubtel SMS debit.",
      "Allowance vs paid split is reconstructed FIFO: monthly allowance credits are consumed before purchased credits.",
      "MFA/login OTP SMS bypass the credit wallet and are not included here.",
      "transactional_notification_sms_log covers fireTransactionalNotification sends only when deployed.",
      "Hubtel balance and aggregate send counts are dashboard-only for programmable SMS keys unless Hubtel enables GET /v1/account/profile and GET /v1/messages on sms.hubtel.com.",
    ],
  };
}
