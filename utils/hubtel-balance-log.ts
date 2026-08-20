import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformHubtelBalanceEstimate } from "@/utils/platform-sms-usage-types";

/** Confirmed Hubtel wholesale rate per SMS (Aug 2026). */
export const HUBTEL_SMS_UNIT_COST_GHS = 0.0243;

type HubtelBalanceLogRow = {
  id: string;
  amount_ghs: number | string;
  logged_at: string;
  logged_by: string;
  note: string | null;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseAmount(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function countTransactionalSendsSince(
  admin: SupabaseClient,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await admin
    .from("sms_credit_transactions")
    .select("id", { count: "exact", head: true })
    .eq("reason", "send")
    .gte("created_at", sinceIso);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function countOtpSendsSince(
  admin: SupabaseClient,
  sinceIso: string,
): Promise<number> {
  const { count, error } = await admin
    .from("login_sms_otp_challenges")
    .select("id", { count: "exact", head: true })
    .not("hubtel_message_id", "is", null)
    .gte("created_at", sinceIso);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

async function loadLatestHubtelBalanceLog(
  admin: SupabaseClient,
): Promise<HubtelBalanceLogRow | null> {
  const { data, error } = await admin
    .from("hubtel_balance_log")
    .select("id, amount_ghs, logged_at, logged_by, note")
    .order("logged_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const message = error.message.toLowerCase();
    if (
      message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("could not find the table")
    ) {
      return null;
    }
    throw new Error(error.message);
  }

  return (data as HubtelBalanceLogRow | null) ?? null;
}

export async function computeHubtelBalanceEstimate(
  admin: SupabaseClient,
): Promise<PlatformHubtelBalanceEstimate> {
  const latest = await loadLatestHubtelBalanceLog(admin);

  if (!latest) {
    return {
      available: false,
      estimatedBalanceGhs: null,
      lastLoggedAmountGhs: null,
      lastLoggedAt: null,
      lastLoggedNote: null,
      transactionalSendsSinceLog: 0,
      otpSendsSinceLog: 0,
      totalSendsSinceLog: 0,
      smsUnitCostGhs: HUBTEL_SMS_UNIT_COST_GHS,
      estimatedSpendSinceLogGhs: null,
      note: "Log a balance reading from the Hubtel dashboard to enable estimates.",
    };
  }

  const lastLoggedAmountGhs = parseAmount(latest.amount_ghs);
  const [transactionalSendsSinceLog, otpSendsSinceLog] = await Promise.all([
    countTransactionalSendsSince(admin, latest.logged_at),
    countOtpSendsSince(admin, latest.logged_at),
  ]);

  const totalSendsSinceLog = transactionalSendsSinceLog + otpSendsSinceLog;
  const estimatedSpendSinceLogGhs = roundMoney(
    totalSendsSinceLog * HUBTEL_SMS_UNIT_COST_GHS,
  );
  const estimatedBalanceGhs = roundMoney(
    lastLoggedAmountGhs - estimatedSpendSinceLogGhs,
  );

  return {
    available: true,
    estimatedBalanceGhs,
    lastLoggedAmountGhs,
    lastLoggedAt: latest.logged_at,
    lastLoggedNote: latest.note,
    transactionalSendsSinceLog,
    otpSendsSinceLog,
    totalSendsSinceLog,
    smsUnitCostGhs: HUBTEL_SMS_UNIT_COST_GHS,
    estimatedSpendSinceLogGhs,
    note: null,
  };
}

export async function insertHubtelBalanceLog(
  admin: SupabaseClient,
  options: {
    amountGhs: number;
    loggedBy: string;
    note?: string | null;
  },
): Promise<HubtelBalanceLogRow> {
  const amount = roundMoney(options.amountGhs);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("amount_ghs must be a non-negative number.");
  }

  const { data, error } = await admin
    .from("hubtel_balance_log")
    .insert({
      amount_ghs: amount,
      logged_by: options.loggedBy,
      note: options.note?.trim() || null,
    })
    .select("id, amount_ghs, logged_at, logged_by, note")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as HubtelBalanceLogRow;
}
