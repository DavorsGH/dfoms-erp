import { cookies } from "next/headers";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  BILLING_INVOICE_SELECT,
  BILLING_SETTINGS_SELECT,
  emptyBillingSettings,
  type BillingInvoiceRow,
  type BillingSettingsRow,
} from "@/utils/billing-settings-types";
import { getTenantBillingSubscription } from "@/utils/billing-subscription";
import {
  CRM_PRODUCT_SELECT,
  ERP_SUITE_CATEGORY,
} from "../../crm/products/products-utils";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import BillingSettings, {
  type BillingTierOption,
} from "../billing-settings";

const BILLING_TIER_SELECT =
  `${CRM_PRODUCT_SELECT}, price_ghs` as const;

export default async function BillingSettingsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Billing Settings
        </h2>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();

  const [
    subscription,
    billingSettingsResult,
    invoicesResult,
    tiersResult,
  ] = await Promise.all([
    getTenantBillingSubscription(tenantId),
    supabase
      .from("billing_settings")
      .select(BILLING_SETTINGS_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("invoices")
      .select(BILLING_INVOICE_SELECT)
      .eq("tenant_id", tenantId)
      .order("invoice_date", { ascending: false }),
    admin
      .from("crm_products")
      .select(BILLING_TIER_SELECT)
      .eq("tenant_id", DAVORS_TENANT_ID)
      .eq("category", ERP_SUITE_CATEGORY)
      .order("name", { ascending: true }),
  ]);

  let billingSettings = (billingSettingsResult.data as BillingSettingsRow | null) ??
    emptyBillingSettings(tenantId);

  if (!billingSettingsResult.data && !billingSettingsResult.error) {
    const { data: inserted } = await supabase
      .from("billing_settings")
      .insert(emptyBillingSettings(tenantId))
      .select(BILLING_SETTINGS_SELECT)
      .single();

    if (inserted) {
      billingSettings = inserted as BillingSettingsRow;
    }
  }

  const fetchError =
    billingSettingsResult.error?.message ??
    invoicesResult.error?.message ??
    tiersResult.error?.message ??
    null;

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Billing Settings
      </h2>
      <BillingSettings
        subscription={subscription}
        billingSettings={billingSettings}
        invoices={(invoicesResult.data as BillingInvoiceRow[] | null) ?? []}
        tierOptions={(tiersResult.data as BillingTierOption[] | null) ?? []}
        fetchError={fetchError}
      />
    </>
  );
}
