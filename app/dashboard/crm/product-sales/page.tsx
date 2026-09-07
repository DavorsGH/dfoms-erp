import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserEmployeeId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { fetchScopedEmployeeIds, applyEmployeeIdScope } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "@/app/dashboard/hr-payroll/employee-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../../inventory/finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
  scopedFinishedProductsQuery,
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
  const [activeBusinessUnitId, viewAllBusinessUnits, tenantId, defaultSalesRepId] =
    await Promise.all([
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
      getCurrentUserTenantId(),
      getCurrentUserEmployeeId(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  if (!tenantId) {
    throw new Error("Unable to resolve workspace session for Product Sales.");
  }

  const { employeeIds, error: employeeScopeError } =
    await fetchScopedEmployeeIds(supabase, tenantId, buScope);

  const [
    { data, error },
    { data: clients, error: clientsError },
    { data: finishedProducts, error: finishedProductsError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("income_register")
        .select(PRODUCT_SALES_SELECT)
        .eq("entry_type", "product_sale"),
      buScope,
    ).order("date", { ascending: false }),
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", { ascending: true }),
    scopedFinishedProductsQuery(supabase, buScope, FINISHED_PRODUCT_SELECT)
      .eq("is_archived", false)
      .order("product_name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", { ascending: true }),
    applyEmployeeIdScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      employeeIds,
    ).order("full_name"),
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
    employeesError?.message ??
    employeeScopeError ??
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
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        defaultSalesRepId={defaultSalesRepId ?? ""}
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
        tenantId={tenantId}
      />
    </CrmShell>
  );
}
