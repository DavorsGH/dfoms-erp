import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentAuthUid,
  getCurrentUserEmployeeId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import { canAccessCrmSection } from "@/utils/rbac-access";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { CLIENT_SELECT, type ClientEntry } from "../operations/clients-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../inventory/finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
} from "../inventory/finished-product-bu-stock-utils";
import {
  SALES_QUOTE_HEADER_SELECT,
  SALES_QUOTE_LINE_ITEM_SELECT,
  type SalesQuoteHeaderRow,
  type SalesQuoteLineItemRow,
} from "@/utils/sales-quotes-types";
import { buildPosCartLinesFromQuote } from "./pos-utils";
import CrmShell from "../crm/crm-shell";
import PosCacheShell from "./pos-cache-shell";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../hr-payroll/employee-utils";
import { buildCustomerBalancesPayload } from "@/lib/client-cache/pos-cache-mappers";
import { LOYALTY_ACCOUNT_SELECT } from "@/utils/loyalty-types";

type PosPageProps = {
  searchParams: Promise<{ quoteId?: string | string[] }>;
};

export default async function PosPage({ searchParams }: PosPageProps) {
  const params = await searchParams;
  const quoteIdParam = params.quoteId;
  const quoteId =
    typeof quoteIdParam === "string"
      ? quoteIdParam.trim()
      : Array.isArray(quoteIdParam)
        ? quoteIdParam[0]?.trim() ?? ""
        : "";

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [
    role,
    defaultSalesRepId,
    tenantId,
    authUid,
    activeBusinessUnitId,
    viewAllBusinessUnits,
  ] = await Promise.all([
    getCurrentUserRole(),
    getCurrentUserEmployeeId(),
    getCurrentUserTenantId(),
    getCurrentAuthUid(),
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const showCrmNav = canAccessCrmSection(role as AppRole | null);

  if (!tenantId || !authUid) {
    throw new Error("Unable to resolve workspace session for POS cache.");
  }

  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const { employeeIds, error: employeeScopeError } =
    await fetchScopedEmployeeIds(supabase, tenantId, buScope);

  const quoteFetchPromise = quoteId
    ? Promise.all([
        supabase
          .from("sales_quotes")
          .select(SALES_QUOTE_HEADER_SELECT)
          .eq("id", quoteId)
          .maybeSingle(),
        supabase
          .from("sales_quote_line_items")
          .select(SALES_QUOTE_LINE_ITEM_SELECT)
          .eq("quote_id", quoteId)
          .order("sort_order", { ascending: true }),
      ])
    : Promise.resolve([{ data: null, error: null }, { data: null, error: null }] as const);

  const [
    { data: clients, error: clientsError },
    { data: products, error: productsError },
    { data: paymentMethods, error: paymentMethodsError },
    { data: employees, error: employeesError },
    { data: loyaltyAccounts, error: loyaltyError },
    { data: openArRows, error: openArError },
    quoteResults,
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .eq("is_archived", false)
      .order("product_name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", {
      ascending: true,
    }),
    applyEmployeeIdScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      employeeIds,
    ).order("full_name"),
    supabase
      .from("loyalty_accounts")
      .select(LOYALTY_ACCOUNT_SELECT),
    supabase
      .from("income_register")
      .select("client_id, outstanding_balance")
      .gt("outstanding_balance", 0)
      .not("client_id", "is", null),
    quoteFetchPromise,
  ]);

  const [{ data: quoteRow, error: quoteError }, { data: quoteLines, error: quoteLinesError }] =
    quoteResults;

  const { stockMap, error: stockScopeError } =
    await fetchScopedFinishedProductStock(supabase, tenantId, buScope);

  const normalizedProducts = mergeScopedStockOntoProducts(
    ((products as FinishedProductRecord[] | null) ?? []).map((row) =>
      normalizeFinishedProduct(row),
    ),
    stockMap,
  );

  const clientRows = (clients as ClientEntry[] | null) ?? [];
  const loyaltyByClientId = new Map<string, number>();
  for (const row of loyaltyAccounts ?? []) {
    const clientId = String(
      (row as { client_id?: string }).client_id ?? "",
    ).trim();
    if (!clientId) continue;
    loyaltyByClientId.set(
      clientId,
      Number((row as { points_balance?: number }).points_balance) || 0,
    );
  }

  const openArByClientId = new Map<string, number>();
  for (const row of openArRows ?? []) {
    const clientId = String(
      (row as { client_id?: string }).client_id ?? "",
    ).trim();
    if (!clientId) continue;
    const outstanding =
      Number((row as { outstanding_balance?: number }).outstanding_balance) ||
      0;
    if (outstanding <= 0) continue;
    openArByClientId.set(
      clientId,
      Math.round(((openArByClientId.get(clientId) ?? 0) + outstanding) * 100) /
        100,
    );
  }

  const customerBalances = buildCustomerBalancesPayload({
    clients: clientRows.map((c) => ({
      client_id: c.client_id,
      client_name: c.client_name,
    })),
    loyaltyByClientId,
    openArByClientId,
  });

  const quote =
    quoteRow &&
    (quoteRow as SalesQuoteHeaderRow).quote_type === "product" &&
    (quoteRow as SalesQuoteHeaderRow).status === "accepted"
      ? (quoteRow as SalesQuoteHeaderRow)
      : null;

  const quoteCartLines = quote
    ? buildPosCartLinesFromQuote(
        ((quoteLines as SalesQuoteLineItemRow[] | null) ?? []).map((line) => ({
          product_id: line.product_id,
          quantity: line.quantity,
          unit_price: line.unit_price,
        })),
        normalizedProducts,
      )
    : [];

  let fetchError =
    employeeScopeError ??
    stockScopeError ??
    clientsError?.message ??
    productsError?.message ??
    paymentMethodsError?.message ??
    employeesError?.message ??
    loyaltyError?.message ??
    openArError?.message ??
    null;

  if (quoteId && !quote) {
    fetchError =
      quoteError?.message ??
      quoteLinesError?.message ??
      "Quote not found or not eligible for POS conversion.";
  } else if (quoteId && quote && quoteCartLines.length === 0) {
    fetchError =
      "Quote has no product lines that can be loaded into the POS cart.";
  }

  const checkout = (
    <PosCacheShell
      session={{ tenantId, authUid }}
      showTitle={!showCrmNav}
      initialClients={clientRows}
      initialProducts={normalizedProducts}
      initialCustomerBalances={customerBalances}
      initialEmployees={filterActiveEmployees(
        (employees as HrEmployee[] | null) ?? [],
      )}
      defaultSalesRepId={defaultSalesRepId ?? ""}
      initialPaymentMethods={
        ((paymentMethods as { name: string }[] | null) ?? []).map(
          (row) => row.name,
        )
      }
      quoteConversionId={quote?.id}
      quoteNumber={quote?.quote_number}
      initialCartLines={quoteCartLines}
      initialClientId={quote?.client_id ?? ""}
      initialNotes={quote?.notes ?? ""}
      fetchError={fetchError}
      initialCachedAt={new Date().toISOString()}
      activeBusinessUnitId={activeBusinessUnitId}
      tenantId={tenantId}
    />
  );

  if (!showCrmNav) {
    return checkout;
  }

  return <CrmShell sectionTitle="POS">{checkout}</CrmShell>;
}
