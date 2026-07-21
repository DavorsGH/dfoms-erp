import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import {
  PO_FINISHED_PRODUCT_OPTION_SELECT,
  PO_RAW_MATERIAL_OPTION_SELECT,
  type PurchaseOrderFinishedProductOption,
  type PurchaseOrderRawMaterialOption,
} from "@/utils/purchase-orders-types";
import { SUPPLIER_SELECT, type SupplierRow } from "@/utils/suppliers-types";
import InventoryShell from "../../inventory-shell";
import PurchaseOrderForm from "../purchase-order-form";

export default async function NewPurchaseOrderPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <InventoryShell sectionTitle="New Purchase Order">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </InventoryShell>
    );
  }

  const role = (await getCurrentUserRole()) as AppRole | null;

  if (!canEditInventory(role)) {
    return (
      <InventoryShell sectionTitle="New Purchase Order">
        <p className="text-sm text-red-700">
          You do not have permission to create purchase orders.
        </p>
      </InventoryShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [
    { data: suppliers, error: suppliersError },
    { data: rawMaterials, error: rawMaterialsError },
    { data: finishedProducts, error: finishedProductsError },
  ] = await Promise.all([
    supabase
      .from("suppliers")
      .select(SUPPLIER_SELECT)
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("raw_materials")
      .select(PO_RAW_MATERIAL_OPTION_SELECT)
      .eq("tenant_id", tenantId)
      .order("material_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(PO_FINISHED_PRODUCT_OPTION_SELECT)
      .eq("tenant_id", tenantId)
      .eq("sourcing_type", "purchased")
      .order("product_name", { ascending: true }),
  ]);

  return (
    <InventoryShell sectionTitle="New Purchase Order">
      <div className="mb-6">
        <Link
          href="/dashboard/inventory/purchase-orders"
          className="text-sm font-medium text-[#0f2744] hover:underline"
        >
          ← Back to purchase orders
        </Link>
      </div>
      <PurchaseOrderForm
        initialSuppliers={(suppliers as SupplierRow[] | null) ?? []}
        initialRawMaterials={
          (rawMaterials as PurchaseOrderRawMaterialOption[] | null) ?? []
        }
        initialFinishedProducts={
          (finishedProducts as PurchaseOrderFinishedProductOption[] | null) ?? []
        }
        fetchError={
          suppliersError?.message ??
          rawMaterialsError?.message ??
          finishedProductsError?.message ??
          null
        }
      />
    </InventoryShell>
  );
}
