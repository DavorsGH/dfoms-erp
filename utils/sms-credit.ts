import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Debit one SMS credit for the tenant. Returns true when the debit succeeds
 * (wallet had balance). Uses the service-role client so send paths that run
 * as the authenticated user can still gate on the shared wallet RPC.
 *
 * Same contract as fireTransactionalNotification: success → caller may send
 * SMS; false → skip SMS (do not call Hubtel).
 */
export async function tryDebitSmsCredit(tenantId: string): Promise<boolean> {
  const cleaned = tenantId?.trim() ?? "";
  if (!cleaned) {
    console.error("[sms-credit] debit_sms_credit skipped: missing tenantId.");
    return false;
  }

  const admin = createAdminClient();
  const { data: debitOk, error: debitError } = await admin.rpc(
    "debit_sms_credit",
    { p_tenant_id: cleaned },
  );

  if (debitError) {
    console.error(
      `[sms-credit] debit_sms_credit failed for tenant ${cleaned}:`,
      debitError.message,
    );
    return false;
  }

  return debitOk === true;
}
