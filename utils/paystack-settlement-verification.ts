import "server-only";

import { getPaystackSubaccount } from "@/utils/paystack-subaccounts";
import { createAdminClient } from "@/utils/supabase/admin";
import { notifyTenantAdminsAndDirectors } from "@/utils/tenant-admin-director-notifications";
import {
  ONLINE_PAYMENTS_HREF,
  SETTLEMENT_VERIFICATION_MAX_AGE_MS,
  claimSettlementVerificationSlot,
  releaseSettlementVerificationSlot,
  shouldScheduleSettlementVerification,
} from "@/utils/product-sale-paystack";

export type SettlementVerificationRow = {
  paystack_subaccount_code: string | null;
  paystack_subaccount_status: string | null;
  paystack_subaccount_verified_ok: boolean | null;
  paystack_subaccount_last_verified_at: string | null;
  paystack_subaccount_last_verify_error: string | null;
};

export type SettlementVerificationPersistResult = {
  verifiedOk: boolean;
  lastVerifiedAt: string;
  lastVerifyError: string | null;
  account: { bankName: string; accountLast4: string } | null;
  /** True when a previously successful verification flipped to failed. */
  newlyFailed: boolean;
};

const SETTLEMENT_VERIFY_SELECT =
  "paystack_subaccount_code, paystack_subaccount_status, paystack_subaccount_verified_ok, paystack_subaccount_last_verified_at, paystack_subaccount_last_verify_error" as const;

/**
 * Fetch the Paystack subaccount and persist verified_ok / timestamps on
 * billing_settings. Best-effort notification when a previously connected
 * account fails verification.
 */
export async function verifyAndPersistSettlementSubaccount(
  tenantId: string,
): Promise<SettlementVerificationPersistResult | null> {
  const trimmed = tenantId.trim();
  if (!trimmed) {
    return null;
  }

  const admin = createAdminClient();
  const { data: row, error: loadError } = await admin
    .from("billing_settings")
    .select(SETTLEMENT_VERIFY_SELECT)
    .eq("tenant_id", trimmed)
    .maybeSingle();

  if (loadError || !row) {
    return null;
  }

  const code = row.paystack_subaccount_code?.trim() ?? "";
  if (row.paystack_subaccount_status !== "active" || !code) {
    return null;
  }

  const previouslyOk = row.paystack_subaccount_verified_ok === true;
  const nowIso = new Date().toISOString();
  const paystackResult = await getPaystackSubaccount(code);

  if (!paystackResult.ok) {
    const errorMessage = paystackResult.error?.trim() || "Paystack subaccount verification failed.";
    await admin
      .from("billing_settings")
      .update({
        paystack_subaccount_verified_ok: false,
        paystack_subaccount_last_verified_at: nowIso,
        paystack_subaccount_last_verify_error: errorMessage,
      })
      .eq("tenant_id", trimmed);

    if (previouslyOk) {
      void notifyTenantAdminsAndDirectors(
        trimmed,
        "Online Payments need attention",
        "Paystack can't find this settlement account. Update it under Administration → Finance Settings → Online Payments.",
        ONLINE_PAYMENTS_HREF,
      );
    }

    return {
      verifiedOk: false,
      lastVerifiedAt: nowIso,
      lastVerifyError: errorMessage,
      account: null,
      newlyFailed: previouslyOk,
    };
  }

  await admin
    .from("billing_settings")
    .update({
      paystack_subaccount_verified_ok: true,
      paystack_subaccount_last_verified_at: nowIso,
      paystack_subaccount_last_verify_error: null,
    })
    .eq("tenant_id", trimmed);

  return {
    verifiedOk: true,
    lastVerifiedAt: nowIso,
    lastVerifyError: null,
    account: {
      bankName: paystackResult.data.bankName,
      accountLast4: paystackResult.data.accountLast4,
    },
    newlyFailed: false,
  };
}

/**
 * Fire-and-forget re-check when never verified (NULL) or older than 7 days.
 * Does not block Mobile Money for NULL / true; only one in-flight call per
 * tenant (no repeated Paystack hits on every page load).
 *
 * @returns true when a new background job was scheduled.
 */
export function scheduleSettlementVerificationIfStale(
  tenantId: string,
  lastVerifiedAt: string | null | undefined,
): boolean {
  const trimmed = tenantId.trim();
  if (!trimmed) {
    return false;
  }
  if (!shouldScheduleSettlementVerification(lastVerifiedAt, Date.now())) {
    return false;
  }
  if (!claimSettlementVerificationSlot(trimmed)) {
    return false;
  }
  void verifyAndPersistSettlementSubaccount(trimmed)
    .catch((error) => {
      console.warn(
        "[paystack-settlement-verification] background re-check failed:",
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      releaseSettlementVerificationSlot(trimmed);
    });
  return true;
}

export {
  shouldScheduleSettlementVerification,
  claimSettlementVerificationSlot,
  releaseSettlementVerificationSlot,
};

export type NightlySettlementVerificationSummary = {
  checked: number;
  verifiedOk: number;
  failed: number;
  newlyFailed: number;
  skipped: number;
};

/**
 * Nightly: verify every tenant billing_settings row that has an active
 * Paystack settlement subaccount code.
 */
export async function verifyAllTenantSettlementSubaccounts(): Promise<NightlySettlementVerificationSummary> {
  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("billing_settings")
    .select("tenant_id, paystack_subaccount_code, paystack_subaccount_status")
    .eq("paystack_subaccount_status", "active")
    .not("paystack_subaccount_code", "is", null);

  if (error) {
    throw new Error(error.message);
  }

  const summary: NightlySettlementVerificationSummary = {
    checked: 0,
    verifiedOk: 0,
    failed: 0,
    newlyFailed: 0,
    skipped: 0,
  };

  for (const row of rows ?? []) {
    const tenantId = typeof row.tenant_id === "string" ? row.tenant_id.trim() : "";
    const code = row.paystack_subaccount_code?.trim() ?? "";
    if (!tenantId || !code) {
      summary.skipped += 1;
      continue;
    }

    summary.checked += 1;
    const result = await verifyAndPersistSettlementSubaccount(tenantId);
    if (!result) {
      summary.skipped += 1;
      continue;
    }
    if (result.verifiedOk) {
      summary.verifiedOk += 1;
    } else {
      summary.failed += 1;
      if (result.newlyFailed) {
        summary.newlyFailed += 1;
      }
    }
  }

  return summary;
}

/** Exported for tests — max age constant re-export. */
export { SETTLEMENT_VERIFICATION_MAX_AGE_MS };
