import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import CrmShell from "../crm-shell";
import Sales from "./sales";
import {
  CRM_SALE_SELECT,
  normalizeCrmSale,
  type CrmSaleEntry,
} from "./sales-utils";

type CrmSaleRow = Parameters<typeof normalizeCrmSale>[0];

export default async function SalesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("crm_sales")
    .select(CRM_SALE_SELECT)
    .order("sale_date", { ascending: false });

  const sales: CrmSaleEntry[] =
    (data as CrmSaleRow[] | null)?.map((row) => normalizeCrmSale(row)) ?? [];

  return (
    <CrmShell sectionTitle="Sales Log">
      <Sales initialSales={sales} fetchError={error?.message ?? null} />
    </CrmShell>
  );
}
