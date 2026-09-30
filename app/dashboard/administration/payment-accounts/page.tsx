import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadPaymentAccountsForTenant } from "@/utils/payment-accounts-server";
import type { PaymentAccountRow } from "@/utils/payment-accounts-types";
import {
  BUSINESS_UNIT_SELECT,
  type BusinessUnitRow,
} from "@/utils/business-units-types";
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

  let initialAccounts: PaymentAccountRow[] = [];
  let accountsError: string | null = null;

  try {
    initialAccounts = await loadPaymentAccountsForTenant(supabase, tenantId);
  } catch (error) {
    accountsError =
      error instanceof Error ? error.message : "Unable to load payment accounts.";
  }

  const { data: businessUnits, error: businessUnitsError } = await supabase
    .from("business_units")
    .select(BUSINESS_UNIT_SELECT)
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  const fetchError = accountsError ?? businessUnitsError?.message ?? null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Payment Accounts
      </h2>
      <PaymentAccountsSettings
        initialAccounts={initialAccounts}
        businessUnits={(businessUnits as BusinessUnitRow[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
