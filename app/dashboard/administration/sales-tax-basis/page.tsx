import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveStampBusinessUnitId } from "@/utils/business-unit-view";
import {
  TAX_SETTINGS_ON_CONFLICT,
} from "@/utils/phase5e-key-structure";
import {
  DEFAULT_SALES_TAX_BASIS,
  loadTenantSalesTaxBasis,
} from "@/app/dashboard/finance/tax-utils";
import SalesTaxBasisSettings from "../sales-tax-basis";

export default async function SalesTaxBasisPage() {
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);

  if (!tenantId) {
    return (
      <p className="text-sm text-red-700">
        Unable to resolve your workspace. Contact support if this persists.
      </p>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const stamp = resolveStampBusinessUnitId({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  // Ensure a tax_settings row only when a concrete BU stamp is allowed
  // (skip while All Businesses is selected).
  if (stamp.ok) {
    await supabase.from("tax_settings").upsert(
      {
        tenant_id: tenantId,
        business_unit_id: stamp.businessUnitId,
        sales_tax_basis: DEFAULT_SALES_TAX_BASIS,
      },
      { onConflict: TAX_SETTINGS_ON_CONFLICT, ignoreDuplicates: true },
    );
  }

  const { salesTaxBasis, salesTaxBasisReviewedAt, error } =
    await loadTenantSalesTaxBasis(supabase, tenantId, activeBusinessUnitId);

  return (
    <>
      <h2 className="mb-2 text-xl font-semibold text-[#0f2744]">
        VAT/WHT Calculation Basis
      </h2>
      <p className="mb-6 text-sm text-slate-600">
        Choose whether sales tax on Client Invoices and Client Quotations is
        applied to service cost only or to the full line total (service +
        material, net of discounts).
      </p>
      <SalesTaxBasisSettings
        tenantId={tenantId}
        activeBusinessUnitId={activeBusinessUnitId}
        initialSalesTaxBasis={salesTaxBasis}
        initialSalesTaxBasisReviewedAt={salesTaxBasisReviewedAt}
        fetchError={error}
      />
    </>
  );
}
