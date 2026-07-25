import "server-only";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  PAYMENT_SETTINGS_REQUIRED_CODE,
  PAYMENT_SETTINGS_REQUIRED_MESSAGE,
} from "@/utils/product-sale-paystack";

export type SettlementSubaccountResult =
  | { ok: true; subaccountCode: string }
  | {
      ok: false;
      status: number;
      error: string;
      code: typeof PAYMENT_SETTINGS_REQUIRED_CODE | null;
    };

/**
 * Tenant fund routing guard for POS / product-sale customer payments.
 *
 * These charges belong to the tenant, so every Paystack initialize for this
 * flow MUST route funds to the tenant's settlement subaccount. If the tenant
 * has not completed Payment Settings (billing_settings.paystack_subaccount_status
 * !== 'active' or no code stored), callers must BLOCK the charge — never
 * initialize without the subaccount, or the money would settle to the
 * platform's main Paystack account instead of the tenant.
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
    .select("paystack_subaccount_code, paystack_subaccount_status")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, status: 500, error: error.message, code: null };
  }

  const subaccountCode = data?.paystack_subaccount_code?.trim() ?? "";
  if (data?.paystack_subaccount_status !== "active" || !subaccountCode) {
    return {
      ok: false,
      status: 409,
      error: PAYMENT_SETTINGS_REQUIRED_MESSAGE,
      code: PAYMENT_SETTINGS_REQUIRED_CODE,
    };
  }

  return { ok: true, subaccountCode };
}
