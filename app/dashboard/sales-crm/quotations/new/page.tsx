import { cookies } from "next/headers";
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadAuthorizedSignerOptions } from "@/utils/client-invoices-api";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "@/app/dashboard/inventory/finished-products-utils";
import { peekNextQuotationNumber } from "@/utils/client-quotations-api";
import { getCurrentTenantBillingSettingsHeader } from "@/utils/billing-settings-load";
import {
  emptyQuotationForm,
  type ClientQuotationSiteOption,
} from "@/utils/client-quotations-types";
import { PAYMENT_ACCOUNT_SELECT } from "@/utils/payment-accounts-types";
import CrmShell from "@/app/dashboard/crm/crm-shell";
import ClientQuotationForm from "../client-quotation-form";

export default async function NewClientQuotationPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <CrmShell sectionTitle="Quotations">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </CrmShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: customers, error: customersError },
    { data: sites, error: sitesError },
    { data: paymentAccounts, error: paymentAccountsError },
    { data: opportunities, error: opportunitiesError },
    { data: products, error: productsError },
    nextQuotationNumberResult,
    authorizedSignersResult,
    billingSettings,
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    supabase
      .from("sites")
      .select("site_code, site_name, client_id")
      .eq("tenant_id", tenantId)
      .order("site_name", { ascending: true }),
    supabase
      .from("payment_accounts")
      .select(PAYMENT_ACCOUNT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("account_name", { ascending: true }),
    supabase
      .from("sales_opportunities")
      .select("id, opportunity_name, client_id")
      .order("opportunity_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .order("product_name", { ascending: true }),
    peekNextQuotationNumber(supabase, tenantId),
    loadAuthorizedSignerOptions(supabase, tenantId),
    getCurrentTenantBillingSettingsHeader(),
  ]);

  const fetchError =
    customersError?.message ??
    sitesError?.message ??
    paymentAccountsError?.message ??
    opportunitiesError?.message ??
    productsError?.message ??
    nextQuotationNumberResult.error ??
    authorizedSignersResult.error ??
    null;

  return (
    <CrmShell sectionTitle="Quotations">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">New Quotation</h3>
        <Link
          href="/dashboard/sales-crm/quotations"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <ClientQuotationForm
        mode="create"
        tenantId={tenantId}
        nextQuotationNumberPreview={nextQuotationNumberResult.quotationNumber}
        billingSettings={billingSettings}
        initialCustomers={(customers as ClientEntry[] | null) ?? []}
        initialOpportunities={
          (opportunities as
            | { id: string; opportunity_name: string; client_id: string }[]
            | null) ?? []
        }
        initialSites={(sites as ClientQuotationSiteOption[] | null) ?? []}
        initialPaymentAccounts={paymentAccounts ?? []}
        initialAuthorizedSigners={authorizedSignersResult.signers}
        initialProducts={
          ((products as Omit<FinishedProductRecord, "manufacturing_date" | "expiration_date">[] | null) ??
            []).map((row) => normalizeFinishedProduct(row))
        }
        initialForm={emptyQuotationForm()}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
