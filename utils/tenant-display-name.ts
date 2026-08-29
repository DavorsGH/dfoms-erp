import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveInvoiceCompanyName } from "@/app/dashboard/finance/client-invoices/client-invoice-display-utils";
import {
  BILLING_SETTINGS_HEADER_SELECT,
  type BillingSettingsHeaderFields,
} from "@/utils/billing-settings-types";
import {
  DEFAULT_COMPANY_LEGAL_NAME,
  DEFAULT_WORKSPACE_NAME,
  type TenantBranding,
} from "@/utils/tenant-branding-types";

/**
 * Document / email company name for a tenant — same rules as invoice/receipt PDF headers:
 * billing_settings.bill_to_name → tenants.name (company legal / workspace name).
 */
export async function resolveTenantDisplayName(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const [{ data, error }, billingResult] = await Promise.all([
    admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    admin
      .from("billing_settings")
      .select(BILLING_SETTINGS_HEADER_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (error) {
    console.warn(
      `[tenant-display-name] lookup failed (${tenantId}): ${error.message}`,
    );
  }

  if (billingResult.error) {
    console.warn(
      `[tenant-display-name] billing_settings lookup failed (${tenantId}): ${billingResult.error.message}`,
    );
  }

  const workspaceName = data?.name?.trim() || "";
  const branding = {
    workspaceName: workspaceName || DEFAULT_WORKSPACE_NAME,
    companyLegalName: workspaceName || DEFAULT_COMPANY_LEGAL_NAME,
  } as Pick<TenantBranding, "workspaceName" | "companyLegalName">;

  const billingSettings =
    (billingResult.data as BillingSettingsHeaderFields | null) ?? null;

  const companyName = resolveInvoiceCompanyName(
    branding as TenantBranding,
    billingSettings,
  ).trim();

  return companyName || workspaceName || tenantId;
}
