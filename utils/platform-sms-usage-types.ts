export type SmsUsagePeriodKey =
  | "today"
  | "last_7_days"
  | "last_30_days"
  | "all_time";

export type PlatformSmsPeriodBreakdown = {
  period: SmsUsagePeriodKey;
  label: string;
  totalSends: number;
  allowanceSends: number;
  paidSends: number;
};

export type PlatformSmsTenantBreakdown = {
  tenantId: string;
  tenantName: string;
  tenantCode: string | null;
  totalSends: number;
  allowanceSends: number;
  paidSends: number;
  allowanceCreditsGranted: number;
  paidCreditsPurchased: number;
};

export type PlatformSmsTransactionalLogSummary = {
  available: boolean;
  totalLogged: number;
  ledgerSendCount: number;
  discrepancy: number;
  note: string | null;
};

export type PlatformHubtelBalanceSummary = {
  available: boolean;
  balance: number | null;
  currency: string | null;
  accountLabel: string | null;
  endpoint: string | null;
  error: string | null;
};

export type PlatformSmsUsageReport = {
  generatedAt: string;
  totals: {
    totalSends: number;
    allowanceSends: number;
    paidSends: number;
    allowanceCreditsGranted: number;
    paidCreditsPurchased: number;
  };
  periodBreakdown: PlatformSmsPeriodBreakdown[];
  perTenant: PlatformSmsTenantBreakdown[];
  transactionalLog: PlatformSmsTransactionalLogSummary;
  hubtelBalance: PlatformHubtelBalanceSummary;
  notes: string[];
};
