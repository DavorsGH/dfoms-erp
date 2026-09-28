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
import SalesRegister from "./sales-register";
import {
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "../product-sales-utils";
import {
  CRM_WEBHOOK_SALE_SELECT,
  normalizeWebhookSale,
  type CrmSaleEntry,
} from "./sales-utils";

type WebhookSaleRow = Parameters<typeof normalizeWebhookSale>[0];

export default async function SalesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [
    activeBusinessUnitId,
    viewAllBusinessUnits,
    tenantId,
    defaultSalesRepId,
  ] = await Promise.all([
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
    throw new Error("Unable to resolve workspace session for Sales.");
  }

  const { employeeIds, error: employeeScopeError } =
    await fetchScopedEmployeeIds(supabase, tenantId, buScope);

  const webhookQuery = viewAllBusinessUnits
    ? supabase
        .from("crm_sales")
        .select(CRM_WEBHOOK_SALE_SELECT)
        .order("sale_date", { ascending: false })
    : Promise.resolve({ data: [], error: null });

  const [
    { data: incomeRows, error: incomeError },
    { data: webhookRows, error: webhookError },
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
    webhookQuery,
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
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
    ((finishedProducts as FinishedProductRecord[] | null) ?? []).map((product) =>
      normalizeFinishedProduct(product),
    ),
    stockMap,
    buScope.mode,
  );

  const fetchError =
    incomeError?.message ??
    webhookError?.message ??
    clientsError?.message ??
    finishedProductsError?.message ??
    paymentMethodsError?.message ??
    employeesError?.message ??
    employeeScopeError ??
    stockScopeError ??
    null;

  const initialIncomeEntries: ProductSaleEntry[] = (
    (incomeRows as ProductSaleEntry[] | null) ?? []
  ).map((row) => normalizeProductSaleEntry(row));

  const initialWebhookSales: CrmSaleEntry[] = (
    (webhookRows as WebhookSaleRow[] | null) ?? []
  ).map((row) => normalizeWebhookSale(row));

  return (
    <CrmShell sectionTitle="Sales">
      <SalesRegister
        initialIncomeEntries={initialIncomeEntries}
        initialWebhookSales={initialWebhookSales}
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
