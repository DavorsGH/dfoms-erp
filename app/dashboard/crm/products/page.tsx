import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import CrmShell from "../crm-shell";
import Products from "./products";
import { CRM_PRODUCT_SELECT, type CrmProductEntry } from "./products-utils";

export default async function ProductsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("crm_products")
    .select(CRM_PRODUCT_SELECT)
    .order("name", { ascending: true });

  return (
    <CrmShell sectionTitle="Product Catalog">
      <Products
        initialProducts={(data as CrmProductEntry[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
