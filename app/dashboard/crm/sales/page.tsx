import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { ProductSaleEntry } from "../product-sales-utils";
import { CLIENT_SELECT, type ClientEntry } from "../../operations/clients-utils";
import CrmShell from "../crm-shell";
import Sales from "./sales";
import {
  CRM_PRODUCT_SALE_SELECT,
  CRM_WEBHOOK_SALE_SELECT,
  mergeSalesLogEntries,
  normalizeProductSaleForLog,
  normalizeWebhookSale,
  type CrmSaleEntry,
} from "./sales-utils";

type WebhookSaleRow = Parameters<typeof normalizeWebhookSale>[0];

export default async function SalesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data: productSaleRows, error: productSaleError },
    { data: webhookRows, error: webhookError },
    { data: clientRows, error: clientsError },
  ] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("income_register")
        .select(CRM_PRODUCT_SALE_SELECT)
        .eq("entry_type", "product_sale"),
      buScope,
    ).order("date", { ascending: false }),
    supabase
      .from("crm_sales")
      .select(CRM_WEBHOOK_SALE_SELECT)
      .order("sale_date", { ascending: false }),
    supabase.from("customers").select(CLIENT_SELECT).order("client_name", {
      ascending: true,
    }),
  ]);

  const productSales: CrmSaleEntry[] = (
    (productSaleRows as ProductSaleEntry[] | null) ?? []
  ).map((row) => normalizeProductSaleForLog(row));

  const webhookSales: CrmSaleEntry[] = (
    (webhookRows as WebhookSaleRow[] | null) ?? []
  ).map((row) => normalizeWebhookSale(row));

  const sales = mergeSalesLogEntries(productSales, webhookSales);
  const fetchError =
    productSaleError?.message ??
    webhookError?.message ??
    clientsError?.message ??
    null;

  return (
    <CrmShell sectionTitle="Sales Log">
      <Sales
        initialSales={sales}
        initialClients={(clientRows as ClientEntry[] | null) ?? []}
        fetchError={fetchError}
      />
    </CrmShell>
  );
}
