import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getCurrentUserRole, getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { createClient } from "@/utils/supabase/server";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canEditInventory } from "@/utils/rbac-access";
import {
  PURCHASE_ORDER_DETAIL_SELECT,
  normalizePurchaseOrderDetail,
  type PurchaseOrderDetailRow,
} from "@/utils/purchase-orders-types";
import type { NamedLookup } from "../../../lookup-types";
import InventoryShell from "../../inventory-shell";
import PurchaseOrderDetailView from "./purchase-order-view";

type PurchaseOrderPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PurchaseOrderPage({
  params,
}: PurchaseOrderPageProps) {
  const { id } = await params;
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <InventoryShell sectionTitle="Purchase Order">
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </InventoryShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: paymentMethods }] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select(PURCHASE_ORDER_DETAIL_SELECT)
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase.from("payment_methods").select("name").order("name", { ascending: true }),
  ]);

  if (!data && !error) {
    notFound();
  }

  const role = (await getCurrentUserRole()) as AppRole | null;

  return (
    <InventoryShell sectionTitle="Purchase Order">
      {error || !data ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error?.message ?? "Purchase order not found."}
        </p>
      ) : (
        <PurchaseOrderDetailView
          initialPurchaseOrder={normalizePurchaseOrderDetail(
            data as unknown as PurchaseOrderDetailRow,
          )}
          paymentMethods={(paymentMethods as NamedLookup[] | null) ?? []}
          readOnly={!canEditInventory(role)}
        />
      )}
    </InventoryShell>
  );
}
