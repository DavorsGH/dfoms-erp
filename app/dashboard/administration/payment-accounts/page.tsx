import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadPaymentAccountsForTenant } from "@/utils/payment-accounts-server";
import {
  paymentAccountsInvoicePayExample,
  type PaymentAccountRow,
} from "@/utils/payment-accounts-types";
import {
  BUSINESS_UNIT_SELECT,
  type BusinessUnitRow,
} from "@/utils/business-units-types";
import { ONLINE_PAYMENTS_HREF } from "@/utils/product-sale-paystack";
import PaymentAccountsSettings from "../payment-accounts-settings";

function PaymentAccountsIntro({
  invoicePayExample,
}: {
  invoicePayExample: string;
}) {
  return (
    <div className="mb-6 max-w-3xl space-y-3 text-sm text-slate-600">
      <p>Your company&apos;s bank and Mobile Money accounts.</p>

      <div>
        <p className="text-xs font-semibold text-slate-800">What they&apos;re for</p>
        <ul className="mt-1 list-disc space-y-1.5 pl-4">
          <li>
            On invoices and quotations: your customer sees where to pay, e.g.{" "}
            {invoicePayExample}.
          </li>
          <li>
            In your records: when you record money coming in or going out — a
            sale, an expense, a salary advance — you pick which account it went
            through, so you always know where your money is.
          </li>
        </ul>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-800">
          What they&apos;re not for
        </p>
        <ul className="mt-1 list-disc space-y-1.5 pl-4">
          <li>
            Taking Mobile Money at POS or in Sales. DavSuite can&apos;t see money
            arriving in these accounts. For that, use{" "}
            <Link
              href={ONLINE_PAYMENTS_HREF}
              className="font-medium text-[#0f2744] underline underline-offset-2 hover:text-[#1a3a5c]"
            >
              Online Payments
            </Link>
            .
          </li>
        </ul>
      </div>
    </div>
  );
}

export default async function PaymentAccountsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Payment Accounts
        </h2>
        <PaymentAccountsIntro
          invoicePayExample={paymentAccountsInvoicePayExample([])}
        />
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
      <PaymentAccountsIntro
        invoicePayExample={paymentAccountsInvoicePayExample(initialAccounts)}
      />
      <PaymentAccountsSettings
        initialAccounts={initialAccounts}
        businessUnits={(businessUnits as BusinessUnitRow[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
