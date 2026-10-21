import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  BILLING_SETTINGS_SELECT,
  emptyBillingSettings,
  type BillingSettingsRow,
} from "@/utils/billing-settings-types";
import { PAYMENT_ACCOUNTS_HREF } from "@/utils/payment-accounts-types";
import PaymentSettings from "../payment-settings";

function OnlinePaymentsIntro() {
  return (
    <div className="mb-6 max-w-3xl space-y-3 text-sm text-slate-600">
      <p>
        Connect the Paystack account that receives Mobile Money payments made
        through DavSuite (POS, Add sale and payment links). Payments are
        confirmed automatically and paid out to your own bank or Mobile Money
        account.
      </p>
      <div>
        <p className="text-xs font-semibold text-slate-800">
          What it&apos;s not for
        </p>
        <p className="mt-1">
          Invoice bank details or recording where money went — those are in{" "}
          <Link
            href={PAYMENT_ACCOUNTS_HREF}
            className="font-medium text-[#0f2744] underline underline-offset-2 hover:text-[#1a3a5c]"
          >
            Payment Accounts
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

export default async function OnlinePaymentsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Online Payments
        </h2>
        <OnlinePaymentsIntro />
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Online Payments.
        </p>
      </>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { data, error } = await supabase
    .from("billing_settings")
    .select(BILLING_SETTINGS_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const billingSettings: BillingSettingsRow =
    (data as BillingSettingsRow | null) ?? emptyBillingSettings(tenantId);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Online Payments
      </h2>
      <OnlinePaymentsIntro />
      {error ? (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error.message}
        </p>
      ) : null}
      <PaymentSettings
        initialStatus={billingSettings.paystack_subaccount_status}
        initialVerifiedOk={billingSettings.paystack_subaccount_verified_ok}
        initialLastVerifyError={
          billingSettings.paystack_subaccount_last_verify_error
        }
        hidden={false}
      />
    </>
  );
}
