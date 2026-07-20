import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  PAYMENT_ACCOUNT_SELECT,
  type PaymentAccountRow,
} from "@/utils/payment-accounts-types";
import PaymentAccountsSettings from "../payment-accounts-settings";

export default async function PaymentAccountsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Payment Accounts
        </h2>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("payment_accounts")
    .select(PAYMENT_ACCOUNT_SELECT)
    .eq("tenant_id", tenantId)
    .order("account_name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Payment Accounts
      </h2>
      <PaymentAccountsSettings
        initialAccounts={(data as PaymentAccountRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
