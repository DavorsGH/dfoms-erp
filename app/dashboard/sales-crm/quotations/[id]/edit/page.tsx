import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { CLIENT_SELECT, type ClientEntry } from "@/app/dashboard/operations/clients-utils";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { loadAuthorizedSignerOptions } from "@/utils/client-invoices-api";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "@/app/dashboard/inventory/finished-products-utils";
import { loadClientQuotationDetail } from "@/utils/client-quotations-api";
import { getCurrentTenantBillingSettingsHeader, getCurrentTenantGraTin } from "@/utils/billing-settings-load";
import {
  clientQuotationToFormState,
  type ClientQuotationLineItemRow,
  type ClientQuotationSiteOption,
} from "@/utils/client-quotations-types";
import { PAYMENT_ACCOUNT_SELECT } from "@/utils/payment-accounts-types";
import CrmShell from "@/app/dashboard/crm/crm-shell";
import ClientQuotationForm from "../../client-quotation-form";

type EditClientQuotationPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditClientQuotationPage({
  params,
}: EditClientQuotationPageProps) {
  const { id } = await params;
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
    detail,
    { data: customers, error: customersError },
    { data: sites, error: sitesError },
    { data: paymentAccounts, error: paymentAccountsError },
    { data: opportunities, error: opportunitiesError },
    { data: products, error: productsError },
    authorizedSignersResult,
    billingSettings,
    graTin,
  ] = await Promise.all([
    loadClientQuotationDetail(supabase, tenantId, id),
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
      .eq("is_archived", false)
      .order("product_name", { ascending: true }),
    loadAuthorizedSignerOptions(supabase, tenantId),
    getCurrentTenantBillingSettingsHeader(),
    getCurrentTenantGraTin(),
  ]);

  if (!detail.quotation) {
    notFound();
  }

  if (detail.quotation.converted_invoice_id) {
    redirect(`/dashboard/sales-crm/quotations/${id}`);
  }

  const fetchError =
    detail.error ??
    customersError?.message ??
    sitesError?.message ??
    paymentAccountsError?.message ??
    opportunitiesError?.message ??
    productsError?.message ??
    authorizedSignersResult.error ??
    null;

  const initialForm = clientQuotationToFormState(
    detail.quotation,
    detail.line_items as ClientQuotationLineItemRow[],
    detail.payment_account_ids,
    authorizedSignersResult.signers,
  );

  return (
    <CrmShell sectionTitle="Quotations">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h3 className="text-lg font-semibold text-[#0f2744]">
          Edit Quotation {detail.quotation.quotation_number}
        </h3>
        <Link
          href="/dashboard/sales-crm/quotations"
          className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
        >
          Back to list
        </Link>
      </div>
      <ClientQuotationForm
        mode="edit"
        tenantId={tenantId}
        quotationId={id}
        initialBusinessUnitId={detail.quotation.business_unit_id}
        existingQuotationNumber={detail.quotation.quotation_number}
        billingSettings={billingSettings}
        graTin={graTin}
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
        initialForm={initialForm}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
