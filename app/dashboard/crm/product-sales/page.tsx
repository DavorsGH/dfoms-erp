import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../../inventory/finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
} from "../../inventory/finished-product-bu-stock-utils";
import { CLIENT_SELECT, type ClientEntry } from "../../operations/clients-utils";
import CrmShell from "../crm-shell";
import ProductSales from "../product-sales";
import {
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "../product-sales-utils";

export default async function ProductSalesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits, tenantId] =
    await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
      getCurrentUserTenantId(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  if (!tenantId) {
    throw new Error("Unable to resolve workspace session for Product Sales.");
  }

  const [
    { data, error },
    { data: clients, error: clientsError },
    { data: finishedProducts, error: finishedProductsError },
    { data: paymentMethods, error: paymentMethodsError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("income_register")
        .select(PRODUCT_SALES_SELECT)
        .eq("entry_type", "product_sale"),
      buScope,
    ).order("date", { ascending: false }),
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .eq("is_archived", false)
      .order("product_name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", { ascending: true }),
  ]);

  const { stockMap, error: stockScopeError } =
    await fetchScopedFinishedProductStock(supabase, tenantId, buScope);

  const initialFinishedProducts = mergeScopedStockOntoProducts(
    ((finishedProducts as FinishedProductRecord[] | null) ?? []).map(
      (product) => normalizeFinishedProduct(product),
    ),
    stockMap,
    buScope.mode,
  );

  const fetchError =
    error?.message ??
    clientsError?.message ??
    finishedProductsError?.message ??
    paymentMethodsError?.message ??
    stockScopeError ??
    null;

  return (
    <CrmShell sectionTitle="Product Sales">
      <ProductSales
        initialEntries={
          ((data as ProductSaleEntry[] | null) ?? []).map((entry) =>
            normalizeProductSaleEntry(entry),
          )
        }
        initialClients={(clients as ClientEntry[] | null) ?? []}
        initialFinishedProducts={initialFinishedProducts}
        initialPaymentMethods={
          ((paymentMethods as { name: string }[] | null) ?? []).map(
            (row) => row.name,
          )
        }
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
        tenantId={tenantId}
      />
    </CrmShell>
  );
}
