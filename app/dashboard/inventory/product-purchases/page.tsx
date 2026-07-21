import { cookies } from "next/headers";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import {
  normalizeProductPurchaseRow,
  normalizePurchasedProduct,
  PRODUCT_PURCHASE_LIST_SELECT,
  PURCHASED_PRODUCT_SELECT,
  type ProductPurchaseListRow,
  type PurchasedProductOption,
} from "@/utils/product-purchases-types";
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";
import type { NamedLookup } from "../../lookup-types";
import InventoryShell from "../inventory-shell";
import ProductPurchases from "../product-purchases";

export default async function ProductPurchasesPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <InventoryShell sectionTitle="Purchases">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </InventoryShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: purchases, error: purchasesError },
    { data: products, error: productsError },
    { data: suppliers, error: suppliersError },
    { data: paymentMethods, error: paymentMethodsError },
  ] = await Promise.all([
    supabase
      .from("product_purchases")
      .select(PRODUCT_PURCHASE_LIST_SELECT)
      .eq("tenant_id", tenantId)
      .order("purchase_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase
      .from("finished_products")
      .select(PURCHASED_PRODUCT_SELECT)
      .eq("tenant_id", tenantId)
      .eq("sourcing_type", "purchased")
      .order("product_name", { ascending: true }),
    supabase
      .from("suppliers")
      .select(SUPPLIER_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", { ascending: true }),
  ]);

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Purchases">
      <ProductPurchases
        initialPurchases={
          ((purchases as ProductPurchaseListRow[] | null) ?? []).map((row) =>
            normalizeProductPurchaseRow(row),
          )
        }
        initialProducts={
          ((products as PurchasedProductOption[] | null) ?? []).map((row) =>
            normalizePurchasedProduct(row),
          )
        }
        initialSuppliers={(suppliers as SupplierRow[] | null) ?? []}
        initialPaymentMethods={(paymentMethods as NamedLookup[] | null) ?? []}
        fetchError={
          purchasesError?.message ??
          productsError?.message ??
          suppliersError?.message ??
          paymentMethodsError?.message ??
          null
        }
        readOnly={!canEditInventory(role)}
      />
    </InventoryShell>
  );
}
