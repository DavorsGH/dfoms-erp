import "server-only";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  isSettlementSubaccountReady,
  PAYMENT_SETTINGS_REQUIRED_CODE,
  PAYMENT_SETTINGS_REQUIRED_MESSAGE,
} from "@/utils/product-sale-paystack";
import { scheduleSettlementVerificationIfStale } from "@/utils/paystack-settlement-verification";

export type SettlementSubaccountResult =
  | { ok: true; subaccountCode: string }
  | {
      ok: false;
      status: number;
      error: string;
      code: typeof PAYMENT_SETTINGS_REQUIRED_CODE | null;
    };

/**
 * Whether Paystack can collect Mobile Money for this tenant (and optional BU).
 *
 * Settlement is currently tenant-scoped (`billing_settings`); `businessUnitId`
 * is accepted for call-site consistency when settlement becomes per-BU later.
 */
export async function isMobileMoneyCollectionReady(
  tenantId: string,
  _businessUnitId?: string | null,
): Promise<boolean> {
  const trimmed = tenantId.trim();
  if (!trimmed) {
    return false;
  }
  const result = await requireActiveSettlementSubaccount(trimmed);
  return result.ok;
}

/**
 * Tenant fund routing guard for POS / product-sale customer payments.
 *
 * These charges belong to the tenant, so every Paystack initialize for this
 * flow MUST route funds to the tenant's settlement subaccount. Ready means
 * Online Payments is active with a stored code, and verified_ok is not false
 * (true or NULL/never-checked both allow). Stale or never-checked verification
 * still allows collection but schedules a one-at-a-time background re-check.
 * Callers must BLOCK when not ready — never initialize without the
 * subaccount, or money would settle to the platform main Paystack account.
 *
 * Uses the admin client because POS operators may not have RLS access to
 * billing_settings; the lookup is scoped to the caller's own tenant_id.
 */
export async function requireActiveSettlementSubaccount(
  tenantId: string,
): Promise<SettlementSubaccountResult> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_settings")
    .select(
      "paystack_subaccount_code, paystack_subaccount_status, paystack_subaccount_verified_ok, paystack_subaccount_last_verified_at",
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message, code: null };
  }

  if (
    !isSettlementSubaccountReady({
      paystack_subaccount_status: data?.paystack_subaccount_status,
      paystack_subaccount_code: data?.paystack_subaccount_code,
      paystack_subaccount_verified_ok: data?.paystack_subaccount_verified_ok,
      paystack_subaccount_last_verified_at:
        data?.paystack_subaccount_last_verified_at,
    })
  ) {
    return {
      ok: false,
      status: 409,
      error: PAYMENT_SETTINGS_REQUIRED_MESSAGE,
      code: PAYMENT_SETTINGS_REQUIRED_CODE,
    };
  }

  // NULL (never checked) or stale (>7 days) → background verify once per tenant.
  scheduleSettlementVerificationIfStale(
    tenantId,
    data?.paystack_subaccount_last_verified_at,
  );

  return {
    ok: true,
    subaccountCode: data!.paystack_subaccount_code!.trim(),
  };
}
