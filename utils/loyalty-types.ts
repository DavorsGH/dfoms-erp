import { formatGHS } from "@/app/dashboard/finance/income-register-utils";
import { roundMoney, toNumber } from "@/utils/client-invoices-types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const LOYALTY_SETTINGS_SELECT =
  "tenant_id, earn_rate_currency_per_point, redemption_value_per_point" as const;

export const LOYALTY_ACCOUNT_SELECT =
  "id, tenant_id, client_id, points_balance, lifetime_earned, lifetime_redeemed" as const;

export const LOYALTY_TRANSACTION_SELECT =
  "id, tenant_id, client_id, transaction_type, points, source_type, source_reference, notes, created_at" as const;

export type LoyaltySettingsRow = {
  tenant_id: string;
  earn_rate_currency_per_point: number;
  redemption_value_per_point: number;
};

export type LoyaltyAccountRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  points_balance: number;
  lifetime_earned: number;
  lifetime_redeemed: number;
};

export type LoyaltyTransactionRow = {
  id: string;
  tenant_id: string;
  client_id: string;
  transaction_type: "earn" | "redeem" | "adjustment";
  points: number;
  source_type: string | null;
  source_reference: string | null;
  notes: string | null;
  created_at: string;
};

export function formatLoyaltyPoints(value: unknown) {
  const points = toNumber(value);
  return points.toLocaleString("en-GH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function formatLoyaltyMoney(value: unknown) {
  return formatGHS(toNumber(value));
}

export function formatLoyaltyTransactionType(type: string | null | undefined) {
  switch (type) {
    case "earn":
      return "Earned";
    case "redeem":
      return "Redeemed";
    case "adjustment":
      return "Adjustment";
    default:
      return type ?? "—";
  }
}

export function loyaltyTransactionBadgeClassName(type: string | null | undefined) {
  switch (type) {
    case "earn":
      return "bg-emerald-100 text-emerald-900";
    case "redeem":
      return "bg-amber-100 text-amber-950";
    default:
      return "bg-slate-100 text-slate-800";
  }
}

export function normalizeLoyaltySettings(row: LoyaltySettingsRow): LoyaltySettingsRow {
  return {
    ...row,
    earn_rate_currency_per_point: toNumber(row.earn_rate_currency_per_point),
    redemption_value_per_point: toNumber(row.redemption_value_per_point),
  };
}

export function normalizeLoyaltyAccount(row: LoyaltyAccountRow): LoyaltyAccountRow {
  return {
    ...row,
    points_balance: toNumber(row.points_balance),
    lifetime_earned: toNumber(row.lifetime_earned),
    lifetime_redeemed: toNumber(row.lifetime_redeemed),
  };
}

export function normalizeLoyaltyTransaction(
  row: LoyaltyTransactionRow,
): LoyaltyTransactionRow {
  return {
    ...row,
    points: toNumber(row.points),
  };
}

export function defaultLoyaltySettings(): LoyaltySettingsRow {
  return {
    tenant_id: "",
    earn_rate_currency_per_point: 0,
    redemption_value_per_point: 0,
  };
}

export function parseRpcNumeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return roundMoney(value);
  }
  if (typeof value === "string" && value.trim()) {
    return roundMoney(Number.parseFloat(value) || 0);
  }
  return 0;
}

export async function earnLoyaltyPointsForSale(
  supabase: SupabaseClient,
  input: {
    clientId: string;
    amountSpent: number;
    sourceType: string;
    sourceReference: string;
  },
): Promise<string | null> {
  const { error } = await supabase.rpc("earn_loyalty_points", {
    p_client_id: input.clientId,
    p_amount_spent: roundMoney(input.amountSpent),
    p_source_type: input.sourceType,
    p_source_reference: input.sourceReference,
  });

  return error?.message ?? null;
}
