import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserEmployeeId, getCurrentUserRole } from "@/utils/dashboard-auth";
import { canAccessCrmSection } from "@/utils/rbac-access";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { CLIENT_SELECT, type ClientEntry } from "../operations/clients-utils";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../inventory/finished-products-utils";
import {
  SALES_QUOTE_HEADER_SELECT,
  SALES_QUOTE_LINE_ITEM_SELECT,
  type SalesQuoteHeaderRow,
  type SalesQuoteLineItemRow,
} from "@/utils/sales-quotes-types";
import { buildPosCartLinesFromQuote } from "./pos-utils";
import CrmShell from "../crm/crm-shell";
import PosCheckout from "./pos-checkout";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../hr-payroll/employee-utils";

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
  const [role, defaultSalesRepId] = await Promise.all([
    getCurrentUserRole(),
    getCurrentUserEmployeeId(),
  ]);
  const showCrmNav = canAccessCrmSection(role as AppRole | null);

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
    quoteResults,
  ] = await Promise.all([
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    supabase.from("payment_methods").select("name").order("name", {
      ascending: true,
    }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    quoteFetchPromise,
  ]);

  const [{ data: quoteRow, error: quoteError }, { data: quoteLines, error: quoteLinesError }] =
    quoteResults;

  const normalizedProducts = (
    (products as FinishedProductRecord[] | null) ?? []
  ).map((row) => normalizeFinishedProduct(row));

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
    clientsError?.message ??
    productsError?.message ??
    paymentMethodsError?.message ??
    employeesError?.message ??
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
    <PosCheckout
      showTitle={!showCrmNav}
      initialClients={(clients as ClientEntry[] | null) ?? []}
      initialProducts={normalizedProducts}
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
    />
  );

  if (!showCrmNav) {
    return checkout;
  }

  return <CrmShell sectionTitle="POS">{checkout}</CrmShell>;
}
